import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api/imageApi", () => ({
  semanticSearch: vi.fn().mockResolvedValue({ clipUsed: false, results: [] }),
  checkClipHealth: vi.fn().mockResolvedValue(true),
}));

import StarView from "../components/features/f1/StarView";

const images = [
  { id: "1", name: "harbor-lights-01.jpg", filename: "harbor-lights-01.jpg", similarity: 0.9 },
  { id: "2", name: "harbor-lights-02.jpg", filename: "harbor-lights-02.jpg", similarity: 0.4 },
];

describe("StarView build flow", () => {
  it("shows no stars until a map is built, then draws them", async () => {
    render(<StarView images={images} />);

    // Empty sky: the prompt, and nothing else.
    expect(await screen.findByText(/type a word to see images/i)).toBeInTheDocument();
    expect(screen.queryByTitle(/harbor-lights-01/i)).toBeNull();

    fireEvent.change(
      screen.getByPlaceholderText(/type a word to reveal matching images/i),
      { target: { value: "sea" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /build star map/i }));

    await waitFor(() =>
      expect(screen.getByTitle(/harbor-lights-01/i)).toBeInTheDocument(),
    );

    // The silhouette picker, every export and the arrangement dial are gone;
    // distance from the centre is the only thing the map encodes.
    fireEvent.click(screen.getByTitle(/settings/i));
    expect(screen.queryByRole("button", { name: /view svg/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /download svg/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /export results/i })).toBeNull();
    expect(screen.queryByText(/arrange the sky by/i)).toBeNull();
  });
});
