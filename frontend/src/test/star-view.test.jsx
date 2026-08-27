import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/imageApi", () => ({
  semanticSearch: vi.fn().mockResolvedValue({ clipUsed: false, results: [] }),
  checkClipHealth: vi.fn().mockResolvedValue(true),
}));

import { semanticSearch } from "../api/imageApi";
import StarView from "../components/features/f1/StarView";
import FullscreenImageProvider from "../components/shared/FullscreenImage";

/** The sky is empty until a map is built, so drive the real build flow. */
async function buildMap(query = "sea") {
  fireEvent.change(
    screen.getByPlaceholderText(/type a word to reveal matching images/i),
    { target: { value: query } },
  );
  fireEvent.click(screen.getByRole("button", { name: /build star map/i }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: /building/i })).toBeNull(),
  );
}

describe("StarView interactions", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("opens a star's image when its node is clicked", async () => {
    const images = [
      {
        id: "1",
        name: "0000001_Claude Monet - Harbor Lights.jpg",
        imageUrl: "/monet.jpg",
        similarity: 0.9,
      },
      {
        id: "2",
        name: "0000002_Vincent van Gogh - Starry Night.jpg",
        imageUrl: "/vincent.jpg",
        similarity: 1,
      },
      {
        id: "3",
        name: "0000003_Ivan Aivazovsky - Moon Reef.jpg",
        imageUrl: "/ivan.jpg",
        similarity: 0.8,
      },
    ];

    render(
      <StarView
        images={images}
        onBackToIsland={() => {}}
        onBackToShip={() => {}}
      />,
      { wrapper: FullscreenImageProvider },
    );

    // The "Focused Signal" panel was removed in the decluttered layout.
    expect(screen.queryByText(/focused signal/i)).not.toBeInTheDocument();
    // Nothing is on screen until a map is built.
    expect(screen.queryByTitle(/vincent van gogh/i)).toBeNull();

    await buildMap();
    fireEvent.click(screen.getByTitle(/vincent van gogh/i));

    expect(
      await screen.findByRole("img", { name: /vincent van gogh/i }),
    ).toBeInTheDocument();
  });

  it("opens the five most accurate image matches together", async () => {
    const images = [
      {
        id: "1",
        name: "0000001_Claude Monet - Harbor Lights.jpg",
        imageUrl: "/monet.jpg",
        similarity: 0.9,
      },
      {
        id: "2",
        name: "0000002_Vincent van Gogh - Starry Night.jpg",
        imageUrl: "/vincent.jpg",
        similarity: 1,
      },
      {
        id: "3",
        name: "0000003_Ivan Aivazovsky - Moon Reef.jpg",
        imageUrl: "/ivan.jpg",
        similarity: 0.8,
      },
      {
        id: "4",
        name: "0000004_Hilma af Klint - The Swan.jpg",
        imageUrl: "/hilma.jpg",
        similarity: 0.7,
      },
      {
        id: "5",
        name: "0000005_Frida Kahlo - Roots.jpg",
        imageUrl: "/frida.jpg",
        similarity: 0.6,
      },
      {
        id: "6",
        name: "0000006_Pablo Picasso - Guitar.jpg",
        imageUrl: "/pablo.jpg",
        similarity: 0.1,
      },
    ];

    render(
      <StarView
        images={images}
        onBackToIsland={() => {}}
        onBackToShip={() => {}}
      />,
      { wrapper: FullscreenImageProvider },
    );

    await buildMap();
    fireEvent.click(
      screen.getByRole("button", { name: /open top 5 images/i }),
    );

    const gallery = screen.getByRole("heading", { name: /top 5 images/i })
      .parentElement.parentElement;

    expect(within(gallery).getByAltText(/vincent van gogh/i)).toBeInTheDocument();
    expect(within(gallery).getByAltText(/claude monet/i)).toBeInTheDocument();
    expect(within(gallery).getByAltText(/ivan aivazovsky/i)).toBeInTheDocument();
    expect(within(gallery).getByAltText(/hilma af klint/i)).toBeInTheDocument();
    expect(within(gallery).getByAltText(/frida kahlo/i)).toBeInTheDocument();
    expect(within(gallery).queryByAltText(/pablo picasso/i)).not.toBeInTheDocument();
  });

  it("runs a suggested CLIP prompt from the atlas controls", async () => {
    render(
      <StarView
        images={[]}
        onBackToIsland={() => {}}
        onBackToShip={() => {}}
      />,
      { wrapper: FullscreenImageProvider },
    );

    fireEvent.click(screen.getByRole("button", { name: "ocean sunset" }));

    expect(
      screen.getByPlaceholderText(/type a word to reveal matching images/i),
    ).toHaveValue("ocean sunset");
    await waitFor(() => {
      expect(semanticSearch).toHaveBeenCalledWith("ocean sunset", expect.any(Number));
    });
  });

  it("keeps the cinematic result pool when the visible star count narrows", async () => {
    vi.useFakeTimers();
    const images = Array.from({ length: 100 }, (_, index) => ({
      id: `result-${index}`,
      name: `Result ${index}.jpg`,
      similarity: 1 - index / 200,
    }));
    semanticSearch.mockResolvedValueOnce({ clipUsed: true, results: images });

    render(
      <StarView
        images={images}
        onBackToIsland={() => {}}
        onBackToShip={() => {}}
        cinematicMode
      />,
      { wrapper: FullscreenImageProvider },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(13200);
    });

    const starCountLabel = screen.getByText(/Show 12 of/i);
    const starCountSlider = starCountLabel.parentElement.querySelector("input");

    expect(Number(starCountSlider.max)).toBeGreaterThan(12);
    expect(semanticSearch).toHaveBeenCalledTimes(1);
    expect(semanticSearch).not.toHaveBeenCalledWith("sea", 12);
  });

  it("runs the cinematic atlas without panning or zooming the map", async () => {
    vi.useFakeTimers();
    const images = [
      {
        id: "1",
        name: "0000001_Claude Monet - Harbor Lights.jpg",
        imageUrl: "/monet.jpg",
        similarity: 1,
      },
      {
        id: "2",
        name: "0000002_Ivan Aivazovsky - Moon Reef.jpg",
        imageUrl: "/ivan.jpg",
        similarity: 0.9,
      },
    ];

    render(
      <StarView
        images={images}
        onBackToIsland={() => {}}
        onBackToShip={() => {}}
        cinematicMode
      />,
      { wrapper: FullscreenImageProvider },
    );

    const map = screen.getByText("Type a word to see images").parentElement;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6200);
    });
    expect(
      screen.getByPlaceholderText(/type a word to reveal matching images/i),
    ).toHaveValue("sea");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(21400);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(screen.getByText(/theme: ghost ocean/i)).toBeInTheDocument();
    expect(map).toHaveStyle({
      transform: "translate(0px, 0px) scale(1)",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(screen.getByRole("img", { name: /claude monet/i })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(
      screen.getByRole("heading", { name: /top 5 images/i }),
    ).toBeInTheDocument();
    expect(map).toHaveStyle({
      transform: "translate(0px, 0px) scale(1)",
    });
  });
});
