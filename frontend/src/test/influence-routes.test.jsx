import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getF5Coords: vi.fn(),
  getPipelineStatus: vi.fn(),
  runPipelines: vi.fn(),
}));

vi.mock("../api/f5Api", () => ({ getF5Coords: api.getF5Coords }));
vi.mock("../api/pipelineApi", () => ({
  getPipelineStatus: api.getPipelineStatus,
  runPipelines: api.runPipelines,
}));

import InfluenceRoutes from "../components/features/f4/InfluenceRoutes";

function renderScene(props = {}) {
  return render(
    <InfluenceRoutes
      databaseName="archive"
      onSwitchMode={vi.fn()}
      onBackToHistory={vi.fn()}
      onBackToStars={vi.fn()}
      onBackToShip={vi.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  api.getF5Coords.mockReset();
  api.getPipelineStatus.mockReset();
  api.runPipelines.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("InfluenceRoutes (F4, shared wall scene)", () => {
  it("opens on the influence map and offers to build a missing chart", async () => {
    api.getF5Coords.mockResolvedValue({ ok: false, coords: [] });
    api.runPipelines.mockResolvedValue({ ok: true, pipelines: ["f5"] });
    api.getPipelineStatus.mockResolvedValue({ f5: { status: "running", progress: 10 } });

    renderScene();

    // The influence tab is active when opened through F4.
    expect(await screen.findByRole("button", { name: "Influence" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Build F5 Map" }));
    await waitFor(() => {
      expect(api.runPipelines).toHaveBeenCalledWith("f5", "archive");
    });
  });

  it("offers both creativity and influence maps", async () => {
    api.getF5Coords.mockResolvedValue({ ok: true, coords: [] });

    renderScene();

    expect(await screen.findByRole("button", { name: "Creativity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Influence" })).toBeInTheDocument();
  });
});
