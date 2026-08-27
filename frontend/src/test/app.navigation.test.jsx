import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }) => <>{children}</>,
  motion: {
    div: ({ children, ...rest }) => <div {...rest}>{children}</div>,
  },
}));

const showcaseImages = Array.from({ length: 1000 }, (_, index) => ({
  id: `cinematic-${index}`,
  filename: `cinematic-${index}.jpg`,
}));
const smallerArchiveImages = Array.from({ length: 100 }, (_, index) => ({
  id: `small-${index}`,
  filename: `small-${index}.jpg`,
}));

vi.mock("../api/imageApi", () => ({
  setCurrentDatabase: vi.fn(),
  listImages: vi.fn((_limit, database) =>
    Promise.resolve(
      database === "1000_slik_1"
        ? showcaseImages
        : database === "cinematic-db"
          ? smallerArchiveImages
          : [],
    ),
  ),
}));

vi.mock("../api/databaseApi", () => ({
  listDatabases: vi.fn().mockResolvedValue({
    databases: [
      { name: "cinematic-db", image_count: 100 },
      { name: "1000_slik_1", image_count: 1000 },
    ],
  }),
}));

vi.mock("../api/pipelineApi", () => ({
  getPipelineStatus: vi.fn().mockResolvedValue({}),
}));

vi.mock("../components/scenes/ShipExterior", () => ({
  default: ({ isFiringCannons, onCannonSequenceComplete, onEnterWindow }) => (
    <div>
      <h2>Ship Scene</h2>
      {isFiringCannons ? (
        <button type="button" onClick={onCannonSequenceComplete}>
          Complete Cannon Flight
        </button>
      ) : (
        <button type="button" onClick={onEnterWindow}>
          Enter Window
        </button>
      )}
    </div>
  ),
}));

vi.mock("../components/scenes/Room", () => ({
  default: ({ onBackToShip, onFireCannons }) => (
    <div>
      <h2>Room Scene</h2>
      <button type="button" onClick={onBackToShip}>
        Back Ship
      </button>
      <button type="button" onClick={onFireCannons}>
        Fire Cannons
      </button>
    </div>
  ),
}));

vi.mock("../components/scenes/IslandTelescope", () => ({
  default: ({ ballArriving, cinematicMode, onLookThrough, onBackToShip }) => (
    <div>
      <h2>Island Scene</h2>
      <span>{ballArriving ? "Landing Ball" : "No Landing Ball"}</span>
      <span>{cinematicMode ? "Cinematic Island" : "Standard Island"}</span>
      <button type="button" onClick={onLookThrough}>
        Look Through
      </button>
      <button type="button" onClick={onBackToShip}>
        Back Ship
      </button>
    </div>
  ),
}));

vi.mock("../components/features/f1/StarView", () => ({
  default: ({ onBackToShip, onOpenF2 }) => (
    <div>
      <h2>Star Scene</h2>
      <button type="button" onClick={onBackToShip}>
        Return Ship
      </button>
      <button type="button" onClick={onOpenF2}>
        Open F2
      </button>
    </div>
  ),
}));

vi.mock("../components/features/f2/LogbookGallery", () => ({
  default: () => <div>Logbook Gallery Scene</div>,
}));

vi.mock("../components/features/f3/CreativityCurrents", () => ({
  default: () => <div>Creativity Currents Scene</div>,
}));

vi.mock("../components/features/f4/InfluenceRoutes", () => ({
  default: () => <div>Influence Routes Scene</div>,
}));

vi.mock("../components/scenes/Hallway", () => ({
  default: ({ onEnterRoom, onOpenF2 }) => (
    <div>
      <h2>Hallway Scene</h2>
      <button type="button" onClick={onEnterRoom}>
        Chest Room Door
      </button>
      <button type="button" onClick={onOpenF2}>
        Logbook Door
      </button>
    </div>
  ),
}));

vi.mock("../components/features/f6/CaptainsQuarters", () => ({
  default: ({ onBackToShip }) => (
    <div>
      <h2>F6 Scene</h2>
      <button type="button" onClick={onBackToShip}>
        Return Ship
      </button>
    </div>
  ),
}));

import App from "../App";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("App scene navigation", () => {
  it("keeps the ship homepage and routes F2 to the logbook", async () => {
    render(<App />);

    expect(await screen.findByText("Ship Scene")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /toggle scene navigator/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /logbook gallery/i }));

    expect(await screen.findByText("Logbook Gallery Scene")).toBeInTheDocument();
  });

  it("routes the ship door into the hallway hub", async () => {
    render(<App />);

    expect(await screen.findByText("Ship Scene")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /enter window/i }));

    expect(await screen.findByText("Hallway Scene")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /chest room door/i }));

    expect(await screen.findByText("Room Scene")).toBeInTheDocument();
  });

  it("still supports numeric keyboard shortcuts across the route map", async () => {
    render(<App />);

    fireEvent.keyDown(window, { key: "2" });
    expect(await screen.findByText("Hallway Scene")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "3" });
    expect(await screen.findByText("Room Scene")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "7" });
    expect(await screen.findByText("Logbook Gallery Scene")).toBeInTheDocument();
  });

  it("adds dedicated creativity and influence destinations", async () => {
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", { name: /toggle scene navigator/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /creativity currents/i }));
    expect(await screen.findByText("Creativity Currents Scene")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /toggle scene navigator/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /influence routes/i }));
    expect(await screen.findByText("Influence Routes Scene")).toBeInTheDocument();
  });

  it("uses the standard island arrival shot with a landing ball after cannonflight", async () => {
    render(<App />);

    fireEvent.keyDown(window, { key: "3" });
    fireEvent.click(await screen.findByRole("button", { name: /fire cannons/i }));
    const completeFlight = await screen.findByRole("button", {
      name: /complete cannon flight/i,
    });

    vi.useFakeTimers();
    fireEvent.click(completeFlight);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(901);
    });

    expect(screen.getByText("Island Scene")).toBeInTheDocument();
    expect(screen.getByText("Landing Ball")).toBeInTheDocument();
    expect(screen.getByText("Standard Island")).toBeInTheDocument();
  });

  it("starts and exits the cinematic tour from the keyboard", async () => {
    window.localStorage.setItem("warden-ship:selected-database", "cinematic-db");
    render(<App />);

    fireEvent.keyDown(window, { key: "c" });
    expect(await screen.findByText("Cinematic Tour")).toBeInTheDocument();
    expect(window.localStorage.getItem("warden-ship:selected-database")).toBe(
      "1000_slik_1",
    );
    expect(
      screen.queryByRole("button", { name: /toggle scene navigator/i }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.getByRole("button", { name: /toggle scene navigator/i }),
    ).toBeInTheDocument();
  });
});
