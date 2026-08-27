import { useDrag } from "@use-gesture/react";
import { useCallback, useEffect, useRef, useState } from "react";
import LogbookScene from "./LogbookScene";
import useArtworkData from "./useArtworkData";
import SceneLoader from "../../shared/SceneLoader";

const EMPTY_IMAGES = [];

function ChevronIcon({ direction = "left" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
      <path
        d={direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LoadingGate() {
  return <SceneLoader messageKey="logbook" />;
}

export default function LogbookGallery({ databaseName = "default", images = EMPTY_IMAGES }) {
  const [fontReady, setFontReady] = useState(false);
  const [currentSpread, setCurrentSpread] = useState(0);
  const [selectedArtworkId, setSelectedArtworkId] = useState(null);
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const imageCacheRef = useRef(new Map());
  const { artworks, classifications, isLoading, error, ensureClassification } = useArtworkData(currentSpread, databaseName, images);

  useEffect(() => {
    let active = true;
    const loadFont = async () => {
      try {
        const font = new FontFace(
          "Caveat",
          "url(https://fonts.gstatic.com/s/caveat/v18/Wnz6HAc5bAfYB2Q7ZjYY.woff2)",
        );
        await font.load();
        document.fonts.add(font);
      } catch {
        // Keep the gallery usable if the CDN is unavailable.
      }
      if (active) {
        window.setTimeout(() => setFontReady(true), 300);
      }
    };
    loadFont();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleResize = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const visibleArtworks = artworks;

  const totalSpreads = Math.max(1, Math.ceil(visibleArtworks.length / 4));
  const safeSpread = Math.min(currentSpread, totalSpreads - 1);


  useEffect(() => {
    const firstSpread = safeSpread;
    const lastSpread = safeSpread;
    for (let spread = firstSpread; spread <= lastSpread; spread += 1) {
      visibleArtworks.slice(spread * 4, spread * 4 + 4).forEach((artwork) => {
        ensureClassification(artwork);
      });
    }
  }, [ensureClassification, safeSpread, visibleArtworks]);

  const pageArtworks = visibleArtworks.slice(safeSpread * 4, safeSpread * 4 + 4);
  const leftArtworks = pageArtworks.slice(0, 2);
  const rightArtworks = pageArtworks.slice(2, 4);
  const canGoPrev = safeSpread > 0;
  const canGoNext = safeSpread < totalSpreads - 1;

  const turnPage = useCallback(
    (direction) => {
      const delta = direction === "next" ? 1 : -1;
      const nextSpread = safeSpread + delta;
      if (nextSpread < 0 || nextSpread >= totalSpreads) return;

      setCurrentSpread(nextSpread);
    },
    [safeSpread, totalSpreads],
  );

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "ArrowRight") turnPage("next");
      if (event.key === "ArrowLeft") turnPage("prev");
      if (event.key === "Escape") {
        setSelectedArtworkId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [turnPage]);

  const bindDrag = useDrag(
    ({ last, movement: [mx] }) => {
      if (!last || Math.abs(mx) < 50) return;
      turnPage(mx < 0 ? "next" : "prev");
    },
    { axis: "x", filterTaps: true },
  );

  const selectedArtwork = artworks.find((artwork) => artwork.id === selectedArtworkId);
  const selectedClassification = selectedArtwork ? classifications[selectedArtwork.id] : null;

  const handleArtworkSelect = useCallback(
    (artworkId) => {
      setSelectedArtworkId(artworkId);
      const artwork = artworks.find((item) => item.id === artworkId);
      if (artwork) {
        ensureClassification(artwork);
      }
    },
    [artworks, ensureClassification],
  );

  useEffect(() => {
    if (selectedArtwork && !selectedClassification) {
      ensureClassification(selectedArtwork);
    }
  }, [ensureClassification, selectedArtwork, selectedClassification]);

  if (!fontReady) {
    return <LoadingGate />;
  }

  return (
    <main className="relative h-dvh w-dvw overflow-hidden bg-[#0d0a06] text-amber-50" {...bindDrag()}>
      <section className="absolute inset-0 animate-[fadeIn_800ms_ease-out_forwards]" aria-label="Logbook gallery">
        <LogbookScene
          leftArtworks={leftArtworks}
          rightArtworks={rightArtworks}
          spreadIndex={safeSpread}
          classifications={classifications}
          imageCacheRef={imageCacheRef}
          mobile={mobile}
          onArtworkSelect={handleArtworkSelect}
          selectedArtworkId={selectedArtworkId}
          selectedArtwork={selectedArtwork}
          selectedClassification={selectedClassification}
          isEmpty={!visibleArtworks.length && !isLoading}
        />
      </section>

      <>
        <button
          type="button"
          aria-label="Previous spread"
          disabled={!canGoPrev}
          onClick={() => turnPage("prev")}
          className="absolute left-4 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-amber-200/20 bg-black/35 text-amber-100/70 shadow-lg transition hover:bg-black/60 hover:text-amber-100 disabled:opacity-20"
        >
          <ChevronIcon direction="left" />
        </button>
        <button
          type="button"
          aria-label="Next spread"
          disabled={!canGoNext}
          onClick={() => turnPage("next")}
          className="absolute right-4 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-amber-200/20 bg-black/35 text-amber-100/70 shadow-lg transition hover:bg-black/60 hover:text-amber-100 disabled:opacity-20"
        >
          <ChevronIcon direction="right" />
        </button>
      </>

      <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/30 px-3 py-1 font-serif text-sm italic text-amber-100/75 shadow-sm">
        ⚓ Page {safeSpread + 1} of {totalSpreads}
      </div>

      {error ? (
        <div className="absolute bottom-4 left-4 z-20 rounded border border-red-200/20 bg-red-950/60 px-3 py-2 font-serif text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {selectedArtwork ? (
        <aside className="absolute bottom-4 right-4 z-30 max-w-xs rounded border border-amber-100/15 bg-black/75 p-3 font-serif text-sm shadow-2xl backdrop-blur-md">
          <button
            type="button"
            aria-label="Close artwork details"
            className="absolute right-2 top-1 text-amber-100/70"
            onClick={() => setSelectedArtworkId(null)}
          >
            ×
          </button>
          <strong className="block pr-5 text-amber-50">{selectedArtwork.title}</strong>
          <span className="mt-1 block text-amber-100/80">Genre: {selectedClassification?.genre || "..."}</span>
          <span className="block text-amber-100/80">Style: {selectedClassification?.style || "..."}</span>
          <span className="block text-amber-100/80">Author: {selectedClassification?.artist || "..."}</span>
          {selectedClassification?.artistKnown === false && selectedClassification?.artistClosest ? (
            <span className="block text-xs text-amber-100/50">
              Not among the 25 known artists (closest: {selectedClassification.artistClosest})
            </span>
          ) : null}
        </aside>
      ) : null}
    </main>
  );
}
