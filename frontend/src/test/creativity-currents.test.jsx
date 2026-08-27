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

import CreativityCurrents from "../components/features/f3/CreativityCurrents";

const datedCoord = {
  id: "dated",
  filename: "0000001_Artemisia - Dawn.jpg",
  artist: "Artemisia",
  x: -0.4,
  y: 0.2,
  year: 1600,
  distinctiveness: 0.6,
  bridge_score: 0.2,
};

function renderScene(props = {}) {
  return render(
    <CreativityCurrents
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

describe("CreativityCurrents (F3, shared wall scene)", () => {
  it("opens on the creativity map and offers to build a missing chart", async () => {
    api.getF5Coords.mockResolvedValue({ ok: false, coords: [] });
    api.runPipelines.mockResolvedValue({ ok: true, pipelines: ["f5"] });
    api.getPipelineStatus.mockResolvedValue({ f5: { status: "running", progress: 10 } });

    renderScene();

    // The creativity tab is active when opened through F3.
    expect(await screen.findByRole("button", { name: "Creativity" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Build F5 Map" }));
    await waitFor(() => {
      expect(api.runPipelines).toHaveBeenCalledWith("f5", "archive");
    });
  });

  it("plots the chart and explains the creativity reading", async () => {
    api.getF5Coords.mockResolvedValue({ ok: true, coords: [datedCoord] });

    renderScene();

    expect(await screen.findByText("Best 1 images")).toBeInTheDocument();
    expect(
      await screen.findByText(/the higher & brighter the ship, the more creative/i),
    ).toBeInTheDocument();
  });
});
