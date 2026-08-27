import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HoverMenu from "../components/shared/HoverMenu";

describe("HoverMenu", () => {
  it("runs upload on pointer down and choose dataset on click", () => {
    const onChooseFile = vi.fn();
    const onChooseDataset = vi.fn();

    render(
      <HoverMenu
        hasZip={false}
        onChooseFile={onChooseFile}
        onChooseDataset={onChooseDataset}
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: /upload dataset/i }),
    );
    const chooseButton = screen.getByRole("button", {
      name: /choose dataset/i,
    });

    fireEvent.pointerDown(chooseButton);
    expect(onChooseDataset).not.toHaveBeenCalled();

    fireEvent.click(chooseButton);

    expect(onChooseFile).toHaveBeenCalledTimes(1);
    expect(onChooseDataset).toHaveBeenCalledTimes(1);
  });
});
