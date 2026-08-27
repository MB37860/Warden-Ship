import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/imageApi", () => ({
  semanticSearch: vi.fn(),
  checkClipHealth: vi.fn().mockResolvedValue(true),
}));

import { semanticSearch } from "../api/imageApi";
import StarView from "../components/features/f1/StarView";

// The notice fires below a raw cosine of 0.22. CLIP's real band on a painting
// collection is roughly 0.19 (nothing like the query) to 0.35 (a clear hit).
const FAINT = 0.18;
const CLEAR = 0.31;

const result = (similarity) => ({
  clipUsed: true,
  results: [
    {
      id: "1",
      name: "harbor-lights-01.jpg",
      filename: "harbor-lights-01.jpg",
      similarity,
    },
    {
      id: "2",
      name: "harbor-lights-02.jpg",
      filename: "harbor-lights-02.jpg",
      similarity: similarity - 0.03,
    },
  ],
});

const search = async (query = "a modern smartphone on a desk") => {
  fireEvent.change(
    screen.getByPlaceholderText(/type a word to reveal matching images/i),
    { target: { value: query } },
  );
  fireEvent.click(screen.getByRole("button", { name: /build star map/i }));
};

const notice = () => screen.queryByText(/nothing in this archive answers to that/i);

describe("StarView weak-match notice", () => {
  // vitest runs without `globals`, so RTL never registered its auto-cleanup.
  beforeEach(() => {
    vi.mocked(semanticSearch).mockReset();
  });
  afterEach(cleanup);

  it("tells the user when nothing in the archive is close to the query", async () => {
    vi.mocked(semanticSearch).mockResolvedValue(result(FAINT));
    render(<StarView images={[]} />);

    await search();

    await waitFor(() => expect(notice()).toBeInTheDocument());
    // The nearest works are still charted - the notice explains, it does not
    // replace the result.
    expect(screen.getByTitle(/harbor-lights-01/i)).toBeInTheDocument();
  });

  it("stays quiet when the archive does hold a match", async () => {
    vi.mocked(semanticSearch).mockResolvedValue(result(CLEAR));
    render(<StarView images={[]} />);

    await search("a stormy sea at night");

    await waitFor(() => expect(screen.getByTitle(/harbor-lights-01/i)).toBeInTheDocument());
    expect(notice()).toBeNull();
  });

  it("stays quiet when the lexical fallback ranked the sky", async () => {
    // Without CLIP the scores come from filename matching, which lives on a
    // different scale - the cosine threshold would misread it as a miss.
    vi.mocked(semanticSearch).mockResolvedValue({
      clipUsed: false,
      results: [
        { id: "1", name: "harbor-lights-01.jpg", filename: "harbor-lights-01.jpg" },
      ],
    });
    render(<StarView images={[]} />);

    await search();

    await waitFor(() => expect(screen.getByTitle(/harbor-lights-01/i)).toBeInTheDocument());
    expect(notice()).toBeNull();
  });
});
