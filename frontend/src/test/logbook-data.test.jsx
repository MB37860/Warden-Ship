import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import useArtworkData from "../components/features/f2/useArtworkData";

function cachedClassification() {
  return {
    style: { label: "Romanticism", confidence: 0.8 },
    genre: { label: "Landscape", confidence: 0.7 },
    artist: { label: "Unknown", confidence: 0.2 },
  };
}

function imageResponse(images) {
  return {
    ok: true,
    json: async () => ({ database: "archive", images }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("logbook artwork selection", () => {
  it("loads only images whose filename labels need classification", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      imageResponse([
        {
          id: "known",
          filename: "0000001_Claude Monet - Water Lilies.jpg",
          features: { f2: cachedClassification() },
        },
        {
          id: "unknown",
          filename: "unknown_0000002.jpg",
          features: { f2: cachedClassification() },
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useArtworkData(0, "archive"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.artworks.map((artwork) => artwork.id)).toEqual([
      "unknown",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps an all-recognized dataset empty rather than using fallback images", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        imageResponse([
          {
            id: "known",
            filename: "0000001_Claude Monet - Water Lilies.jpg",
          },
        ]),
      ),
    );

    const fallbackImages = [
      { id: "fallback-unknown", filename: "unknown_fallback.jpg" },
    ];
    const { result } = renderHook(() =>
      useArtworkData(0, "archive", fallbackImages),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.artworks).toEqual([]);
  });
});
