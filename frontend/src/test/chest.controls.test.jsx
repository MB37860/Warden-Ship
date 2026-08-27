import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../hooks/useWebGLAvailable", () => ({
  default: () => false,
}));

vi.mock("../components/shared/HoverMenu", () => ({
  default: ({ onChooseDataset }) => (
    <button type="button" onClick={onChooseDataset}>
      Choose Dataset
    </button>
  ),
}));

import Chest from "../components/shared/Chest";

afterEach(() => {
  cleanup();
});

describe("Chest broadside controls", () => {
  it("keeps the dataset menu action available while it is open", () => {
    const onChooseDataset = vi.fn();

    render(
      <Chest
        phase="idle"
        parallax={{ x: 0, y: 0 }}
        menuOpen
        onChestClick={() => {}}
        onFireCannons={() => {}}
        hasZip={false}
        onChooseFile={() => {}}
        onChooseDataset={onChooseDataset}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /choose dataset/i }));

    expect(onChooseDataset).toHaveBeenCalledTimes(1);
  });

  it("aims the cannon button then fires the broadside on a second click", () => {
    const onFireCannons = vi.fn();

    render(
      <Chest
        phase="ready"
        parallax={{ x: 0, y: 0 }}
        menuOpen={false}
        onChestClick={() => {}}
        onFireCannons={onFireCannons}
        hasZip
        onChooseFile={() => {}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /turn to gun deck/i }),
    );

    expect(
      screen.getByRole("button", { name: /fire broadside cannons/i }),
    ).toBeInTheDocument();
    expect(onFireCannons).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: /fire broadside cannons/i }),
    );
    expect(onFireCannons).toHaveBeenCalledTimes(1);
  });
});
