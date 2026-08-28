import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/pipelineApi", () => ({
  runPipelines: vi.fn().mockResolvedValue({ ok: true, pipelines: [] }),
}));
vi.mock("../api/modelsApi", () => ({
  getModelStatus: vi.fn(),
  downloadModels: vi.fn(),
}));

import { downloadModels, getModelStatus } from "../api/modelsApi";
import PipelineSelector from "../components/shared/PipelineSelector";

const model = (key, ready, downloading = false) => ({
  key,
  repo_id: `breskvarmatej/${key}`,
  source: ready ? "downloaded" : "absent",
  ready,
  downloading,
  megabytes: 581,
  feature: "F1 typed search",
  degraded: "base CLIP",
});

const status = (models) => ({
  models,
  ready: models.every((m) => m.ready),
  pending_megabytes: models.filter((m) => !m.ready).length * 581,
});

const notice = () => screen.queryByText(/running on fallback models/i);

describe("PipelineSelector model notice", () => {
  beforeEach(() => {
    vi.mocked(getModelStatus).mockReset();
    vi.mocked(downloadModels).mockReset().mockResolvedValue({ ok: true });
  });
  afterEach(cleanup);

  it("offers the download when a model is missing", async () => {
    vi.mocked(getModelStatus).mockResolvedValue(status([model("clip_art", false)]));
    render(<PipelineSelector onClose={() => {}} dbName="test" />);

    await waitFor(() => expect(notice()).toBeInTheDocument());
    expect(screen.getByText(/581 MB not downloaded/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /download the full models/i }));
    await waitFor(() => expect(downloadModels).toHaveBeenCalledWith(["clip_art"]));
  });

  it("stays quiet when every model is present", async () => {
    vi.mocked(getModelStatus).mockResolvedValue(status([model("clip_art", true)]));
    render(<PipelineSelector onClose={() => {}} dbName="test" />);

    // The dialog itself renders; only the notice is absent.
    await screen.findByText(/F1 - CLIP Embeddings/i);
    expect(notice()).toBeNull();
  });

  it("says nothing when the backend has no models endpoint", async () => {
    // An older backend 404s here. That is not a problem to report to the user.
    vi.mocked(getModelStatus).mockRejectedValue(new Error("404"));
    render(<PipelineSelector onClose={() => {}} dbName="test" />);

    await screen.findByText(/F1 - CLIP Embeddings/i);
    expect(notice()).toBeNull();
  });
});
