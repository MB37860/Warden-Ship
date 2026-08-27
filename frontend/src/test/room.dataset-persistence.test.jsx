import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }) => <>{children}</>,
  motion: {
    div: ({ children, ...rest }) => <div {...rest}>{children}</div>,
  },
}));

vi.mock("../hooks/useChestState", () => ({
  default: () => ({
    phase: "idle",
    triggerOpen: vi.fn(),
    openChest: vi.fn(),
  }),
}));

vi.mock("../hooks/useParallax", () => ({
  default: () => ({ x: 0, y: 0 }),
}));

vi.mock("../components/shared/Chest", () => ({
  default: ({ onChooseDataset }) => (
    <div>
      <button type="button" onClick={onChooseDataset}>
        Open dataset selector
      </button>
    </div>
  ),
}));

vi.mock("../components/shared/StatusText", () => ({
  default: () => null,
}));

vi.mock("../components/shared/PipelineSelector", () => ({
  default: () => null,
}));

vi.mock("../components/shared/LoadingProgress", () => ({
  default: () => null,
}));

vi.mock("../components/shared/DatabaseSelector", () => ({
  default: ({ isOpen, currentDatabase, onDatabaseSelected }) =>
    isOpen ? (
      <div>
        <div data-testid="current-db">{currentDatabase}</div>
        <button
          type="button"
          onClick={() => onDatabaseSelected("persisted-db")}
        >
          Use persisted-db
        </button>
      </div>
    ) : null,
}));

vi.mock("../api/imageApi", () => ({
  listImages: vi.fn().mockResolvedValue([]),
  uploadImageBatch: vi.fn(),
  setCurrentDatabase: vi.fn(),
}));

vi.mock("../api/pipelineApi", () => ({
  getPipelineStatus: vi.fn().mockResolvedValue({}),
}));

import Room from "../components/scenes/Room";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Room dataset persistence", () => {
  it("stores the selected dataset and restores it on reload", async () => {
    const props = {
      appState: "idle",
      setAppState: vi.fn(),
      fileName: "",
      setFileName: vi.fn(),
      onBackToShip: vi.fn(),
      onFireCannons: vi.fn(),
      onImagesReady: vi.fn(),
    };

    const { unmount } = render(<Room {...props} />);

    fireEvent.click(
      screen.getByRole("button", { name: /open dataset selector/i }),
    );
    expect(await screen.findByTestId("current-db")).toHaveTextContent(
      "default",
    );

    fireEvent.click(screen.getByRole("button", { name: /use persisted-db/i }));

    expect(window.localStorage.getItem("warden-ship:selected-database")).toBe(
      "persisted-db",
    );

    unmount();

    render(<Room {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: /open dataset selector/i }),
    );

    expect(await screen.findByTestId("current-db")).toHaveTextContent(
      "persisted-db",
    );
  });
});
