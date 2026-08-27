import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ensureClassification = vi.fn();

vi.mock("../components/features/f2/useArtworkData", () => ({
  default: () => ({
    artworks: [
      { id: "one", title: "Unknown River", artist: "Claude Monet" },
      { id: "two", title: "Unknown Figure", artist: "Rembrandt" },
    ],
    classifications: {
      one: { genre: "Landscape", style: "Impressionism", artist: "Claude Monet" },
      two: { genre: "Portrait", style: "Baroque", artist: "Rembrandt" },
    },
    isLoading: false,
    error: "",
    ensureClassification,
  }),
}));

vi.mock("../components/features/f2/LogbookScene", () => ({
  default: ({ leftArtworks, rightArtworks, isEmpty }) => {
    const artworks = [...leftArtworks, ...rightArtworks];
    return (
      <div data-testid="logbook-scene">
        {isEmpty ? "Empty" : artworks.map((artwork) => <span key={artwork.id}>{artwork.title}</span>)}
      </div>
    );
  },
}));

import LogbookGallery from "../components/features/f2/LogbookGallery";

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.FontFace = class {
    load() {
      return Promise.resolve(this);
    }
  };
  Object.defineProperty(document, "fonts", {
    value: { add: vi.fn() },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function openLoadedGallery() {
  render(<LogbookGallery databaseName="archive" />);
  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(350);
  });
}

describe("LogbookGallery", () => {
  it("renders the loaded artworks on the spread", async () => {
    await openLoadedGallery();

    expect(screen.getByText("Unknown River")).toBeInTheDocument();
    expect(screen.getByText("Unknown Figure")).toBeInTheDocument();
  });

  it("no longer shows the search or filter controls", async () => {
    await openLoadedGallery();

    expect(screen.queryByLabelText("Open filters")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Open search")).not.toBeInTheDocument();
  });
});
