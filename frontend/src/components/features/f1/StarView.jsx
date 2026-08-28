import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { checkClipHealth, semanticSearch } from "../../../api/imageApi";
import {
  buildProximityLinks,
  estimateSkyCapacity,
  fitStarsToSky,
} from "../../../utils/constellationFitter";
import {
  getArtworkDisplayName,
  getArtworkSearchText,
} from "../../../utils/artworkNames";
import { useFullscreenImage } from "../../shared/useFullscreenImage";
import styles from "./StarView.module.css";

const STAR_THEMES = [
  {
    id: "aurora-heat",
    name: "Aurora Heat",
    className: "themeAuroraHeat",
    backgroundShape: "diagonal",
    base: "2, 5, 18",
    nebulaOne: "38, 93, 255",
    nebulaTwo: "214, 55, 255",
    nebulaThree: "255, 126, 45",
    accent: "126, 228, 255",
    panel: "4, 13, 32",
    stops: [
      { at: 0, core: [48, 232, 255], glow: [0, 117, 255] },
      { at: 0.32, core: [71, 127, 255], glow: [56, 72, 255] },
      { at: 0.62, core: [230, 71, 255], glow: [180, 42, 255] },
      { at: 0.82, core: [255, 86, 154], glow: [255, 42, 104] },
      { at: 1, core: [255, 230, 88], glow: [255, 151, 26] },
    ],
  },
  {
    id: "nebo-deep",
    name: "Nebo Deep",
    className: "themeNeboDeep",
    backgroundShape: "vertical",
    base: "1, 5, 24",
    nebulaOne: "24, 92, 255",
    nebulaTwo: "35, 236, 255",
    nebulaThree: "105, 72, 255",
    accent: "142, 242, 255",
    panel: "3, 14, 36",
    stops: [
      { at: 0, core: [82, 247, 255], glow: [0, 151, 255] },
      { at: 0.35, core: [66, 174, 255], glow: [24, 94, 255] },
      { at: 0.65, core: [139, 128, 255], glow: [94, 77, 255] },
      { at: 1, core: [226, 248, 255], glow: [112, 232, 255] },
    ],
  },
  {
    id: "solar-bloom",
    name: "Solar Bloom",
    className: "themeSolarBloom",
    backgroundShape: "arc",
    base: "17, 6, 18",
    nebulaOne: "255, 62, 101",
    nebulaTwo: "255, 190, 48",
    nebulaThree: "255, 47, 190",
    accent: "255, 218, 104",
    panel: "36, 12, 26",
    stops: [
      { at: 0, core: [255, 116, 190], glow: [255, 37, 144] },
      { at: 0.38, core: [255, 92, 110], glow: [255, 45, 76] },
      { at: 0.72, core: [255, 164, 73], glow: [255, 105, 33] },
      { at: 1, core: [255, 246, 157], glow: [255, 195, 54] },
    ],
  },
  {
    id: "ghost-ocean",
    name: "Ghost Ocean",
    className: "themeGhostOcean",
    backgroundShape: "softCloud",
    base: "0, 13, 22",
    nebulaOne: "0, 219, 201",
    nebulaTwo: "91, 255, 204",
    nebulaThree: "72, 119, 255",
    accent: "144, 255, 231",
    panel: "2, 28, 38",
    stops: [
      { at: 0, core: [71, 255, 214], glow: [0, 194, 170] },
      { at: 0.42, core: [120, 255, 237], glow: [23, 226, 214] },
      { at: 0.72, core: [184, 245, 255], glow: [79, 193, 255] },
      { at: 1, core: [255, 255, 255], glow: [161, 255, 240] },
    ],
  },
  {
    id: "ember-void",
    name: "Ember Void",
    className: "themeEmberVoid",
    backgroundShape: "crossing",
    base: "12, 4, 7",
    nebulaOne: "255, 54, 20",
    nebulaTwo: "255, 157, 36",
    nebulaThree: "199, 48, 255",
    accent: "255, 143, 76",
    panel: "30, 9, 13",
    stops: [
      { at: 0, core: [255, 88, 46], glow: [255, 42, 16] },
      { at: 0.42, core: [255, 137, 48], glow: [255, 84, 18] },
      { at: 0.72, core: [255, 206, 94], glow: [255, 145, 28] },
      { at: 1, core: [255, 249, 213], glow: [255, 211, 105] },
    ],
  },
];

const DEFAULT_THEME_ID = "ember-void";
const CINEMATIC_QUERY = "sea";
const CLIP_PROMPT_SUGGESTIONS = [
  "portrait painting",
  "ocean sunset",
  "night sky",
  "forest landscape",
  "flower still life",
];

function hashValue(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededUnit(seed, index) {
  const value = Math.sin(hashValue(`${seed}:${index}`) * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function getBackgroundBandPoint(theme, seed, index, rawX) {
  const spread = (seededUnit(seed, `${index}:band-y`) - 0.5) * 28;
  const wobble =
    Math.sin((rawX + seededUnit(seed, `${index}:phase`) * 35) * 0.11) * 8;

  if (theme.backgroundShape === "vertical") {
    const y = seededUnit(seed, `${index}:vertical-y`) * 112 - 6;
    const x =
      52 +
      Math.sin(y * 0.075) * 14 +
      (seededUnit(seed, `${index}:vertical-x`) - 0.5) * 24;
    return { x: clamp(x, 0, 100), y: clamp(y, 0, 100) };
  }

  if (theme.backgroundShape === "arc") {
    const angle = Math.PI * (0.12 + seededUnit(seed, `${index}:arc-a`) * 0.86);
    const radius = 34 + (seededUnit(seed, `${index}:arc-r`) - 0.5) * 22;
    const x = 50 + Math.cos(angle) * radius * 1.25;
    const y = 63 - Math.sin(angle) * radius * 0.78;
    return { x: clamp(x, 0, 100), y: clamp(y, 0, 100) };
  }

  if (theme.backgroundShape === "softCloud") {
    const angle = seededUnit(seed, `${index}:cloud-a`) * Math.PI * 2;
    const radius = Math.sqrt(seededUnit(seed, `${index}:cloud-r`)) * 38;
    const x =
      54 +
      Math.cos(angle) * radius * 1.35 +
      (seededUnit(seed, `${index}:cloud-x`) - 0.5) * 10;
    const y =
      50 +
      Math.sin(angle) * radius * 0.78 +
      (seededUnit(seed, `${index}:cloud-y`) - 0.5) * 10;
    return { x: clamp(x, 0, 100), y: clamp(y, 0, 100) };
  }

  if (theme.backgroundShape === "crossing") {
    const useSecond = seededUnit(seed, `${index}:cross`) > 0.52;
    const slope = useSecond ? 0.52 : -0.44;
    const intercept = useSecond ? 19 : 78;
    const y = intercept + rawX * slope + spread * 0.86 + wobble * 0.55;
    return {
      x: clamp(rawX + (seededUnit(seed, `${index}:cross-x`) - 0.5) * 7, 0, 100),
      y: clamp(y, 0, 100),
    };
  }

  const y = 76 - rawX * 0.48 + spread + wobble;
  return {
    x: clamp(rawX + (seededUnit(seed, `${index}:band-x`) - 0.5) * 8, 0, 100),
    y: clamp(y, 0, 100),
  };
}

function buildBackgroundStars(theme) {
  const count = 2200;
  const seed = `deep-space:${theme.id}`;

  return Array.from({ length: count }, (_, index) => {
    const bright = seededUnit(seed, `${index}:bright`);
    const rareGiant = bright > 0.988;
    const large = bright > 0.89;
    const tiny = bright < 0.48;
    const inMilkyBand = seededUnit(seed, `${index}:band`) > 0.33;
    const rawX = seededUnit(seed, `${index}:x`) * 100;
    const bandPoint = getBackgroundBandPoint(theme, seed, index, rawX);
    const x = inMilkyBand ? bandPoint.x : rawX;
    const y = inMilkyBand ? bandPoint.y : seededUnit(seed, `${index}:y`) * 100;
    const size = rareGiant
      ? 3.4 + seededUnit(seed, `${index}:giant`) * 3.8
      : large
        ? 1.55 + seededUnit(seed, `${index}:large`) * 2.35
        : tiny
          ? 0.42 + seededUnit(seed, `${index}:tiny`) * 0.66
          : 0.8 + seededUnit(seed, `${index}:size`) * 1.35;
    const opacity = rareGiant
      ? 0.96
      : large
        ? 0.62 + seededUnit(seed, `${index}:opacity`) * 0.34
        : tiny
          ? 0.24 + seededUnit(seed, `${index}:opacity`) * 0.42
          : 0.46 + seededUnit(seed, `${index}:opacity`) * 0.48;
    return {
      id: `${theme.id}-bg-${index}`,
      x,
      y,
      size,
      opacity: inMilkyBand ? Math.min(1, opacity + 0.24) : opacity,
      tint: "rgba(255, 255, 255, 0.96)",
      blur: rareGiant ? 0.55 : large ? 0.16 : 0,
      twinkle: 4 + seededUnit(seed, `${index}:twinkle`) * 10,
      delay: seededUnit(seed, `${index}:delay`) * -9,
      halo: rareGiant ? 22 : large ? 12 : inMilkyBand ? 6.5 : 4,
    };
  });
}

function buildBackgroundClusters(theme) {
  const seed = `space-clusters:${theme.id}`;
  return Array.from({ length: 11 }, (_, index) => {
    const color =
      index % 3 === 0
        ? theme.accent
        : index % 3 === 1
          ? theme.nebulaTwo
          : theme.nebulaThree;

    return {
      id: `${theme.id}-cluster-${index}`,
      x: 10 + seededUnit(seed, `${index}:x`) * 80,
      y: 12 + seededUnit(seed, `${index}:y`) * 76,
      size: 90 + seededUnit(seed, `${index}:size`) * 240,
      opacity: 0.14 + seededUnit(seed, `${index}:opacity`) * 0.22,
      color,
    };
  });
}

function scoreImage(name, query, tags = []) {
  const normalizedName = (name || "").toLowerCase();
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) {
    return 0.4;
  }

  let score = 0;
  const parts = normalizedQuery.split(/\s+/).filter(Boolean);
  parts.forEach((part) => {
    if (normalizedName.includes(part)) {
      score += 0.38;
    }
    if (tags.some((tag) => String(tag).toLowerCase().includes(part))) {
      score += 0.3;
    }
  });

  score += (hashValue(`${normalizedName}:${normalizedQuery}`) % 1000) / 4500;
  return Math.min(1, score);
}

function normalizeSimilarity(similarity) {
  if (typeof similarity !== "number" || Number.isNaN(similarity)) {
    return null;
  }
  if (similarity >= -1 && similarity <= 1) {
    return (similarity + 1) / 2;
  }
  return Math.max(0, Math.min(1, similarity));
}

// When to warn that the archive holds nothing like the query.
//
// Measured over the 100-image WikiArt sample with both CLIP weights the app can
// load: on-target queries ("a stormy sea at night", "horses in a field") top out
// at a cosine of 0.234-0.351, while queries for things a painting collection
// cannot contain ("a modern smartphone on a desk", keyboard mash) still reach
// 0.185-0.260. The two bands OVERLAP, so no threshold can prove the archive has
// no match - CLIP scores every painting as somewhat similar to every phrase.
//
// So this sits below the weakest on-target query measured: it never interrupts a
// search that did find something, and only speaks up when the whole sky comes
// back flat. Queries that miss but score above it stay silent, which is the safe
// direction to be wrong in. Raw cosine, because that is what the backend sends;
// `normalizeSimilarity` maps it into the 0-1 range the stars are scored on.
const WEAK_MATCH_SIMILARITY = 0.22;
const WEAK_MATCH_SCORE = (WEAK_MATCH_SIMILARITY + 1) / 2;

const WEAK_MATCH_NOTICE =
  "Nothing in this archive answers to that. The nearest works are charted below, but the likeness is faint - try wording closer to what a painting can show.";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function buildStarLayout(
  images,
  query,
  maxStars = 120,
  theme = STAR_THEMES[0],
  aspect = 9 / 16,
) {
  const source = images
    .slice(0, Math.min(maxStars, images.length))
    .map((image, index) => {
      const filename =
        image.filename || image.name || `archive-${index + 1}.jpg`;
      const fallbackScore = scoreImage(
        getArtworkSearchText(image, filename),
        query,
        image.tags || [],
      );
      const similarity = normalizeSimilarity(image.similarity) ?? fallbackScore;

      return {
        ...image,
        relevanceScore: similarity,
      };
    });

  const fittedStars = fitStarsToSky({
    images: source,
    query,
    maxStars,
    aspect,
  });
  const count = fittedStars.length;
  const densityFactor = count < 12 ? 1.7 : count < 28 ? 1.3 : 1;
  // Size, brightness, glow and the theme's palette all key off this. It used to
  // be (similarity - min) / range with min and max clamped to 0 and 1, so with
  // CLIP's narrow cosine band every star scored about the same and the sky came
  // out one flat colour at one flat size. Rank spends the theme's full range on
  // whatever spread the query actually produced.
  const lastRank = Math.max(fittedStars.length - 1, 1);

  return fittedStars
    .map(({ image, x, y, distance, radialLight, rank }, index) => {
      const filename =
        image.filename || image.name || `archive-${index + 1}.jpg`;
      const displayName = getArtworkDisplayName(image, filename);
      const similarity = image.relevanceScore;
      const starSeed = hashValue(`sky:${image.id || filename}:${query}`);
      const relativeRelevance = clamp(1 - (rank ?? index) / lastRank, 0, 1);
      const closeness = clamp(0.25 + relativeRelevance * 0.75, 0.05, 1);

      const size =
        6.5 +
        (relativeRelevance * 12 + closeness * 10) *
          (1 + (densityFactor - 1) * 0.55);
      const brightness = clamp(
        0.72 + relativeRelevance * 0.18 + radialLight * 0.08,
        0.72,
        0.98,
      );
      const blur = 0.25 + (1 - relativeRelevance) * 0.8;
      const glow = 1.05 + relativeRelevance * 1.05 + radialLight * 0.35;
      const colorScore = clamp(
        relativeRelevance * 0.82 + similarity * 0.18,
        0,
        1,
      );
      const color = getRelevancePalette(colorScore, theme);
      const rankBoost =
        index === 0
          ? 2.9
          : index === 1
            ? 2.35
            : index === 2
              ? 1.95
              : index < 6
                ? 1.45
                : 1;
      const auraAlpha =
        index === 0
          ? 0.72
          : index === 1
            ? 0.58
            : index === 2
              ? 0.48
              : index < 6
                ? 0.34
                : 0.18;
      const auraSize = 760 + rankBoost * 520;
      const colorWashSize = 520 + rankBoost * 320;
      const glowSize = 720 + rankBoost * 280;
      const sparkSize = 220 + rankBoost * 80;
      const shimmerDuration = 6 + (starSeed % 120) * 0.05;
      const shimmerDelay = (starSeed % 100) * 0.07;

      return {
        id: image.id || `star-${index}`,
        name: displayName,
        filename,
        score: similarity,
        image,
        imageUrl: image.imageUrl || null,
        tags: image.tags || [],
        x,
        y,
        size,
        brightness,
        blur,
        glow,
        color,
        colorScore,
        rankBoost,
        auraAlpha,
        auraSize,
        colorWashSize,
        glowSize,
        sparkSize,
        shimmerDuration,
        shimmerDelay,
        distance,
      };
    })
    .sort((a, b) => b.score - a.score);
}

const MotionDiv = motion.div;

// Shared full-screen viewer payloads for a star (a ranked image match).
function starToImage(star) {
  return {
    src: star.imageUrl,
    label: star.name,
    caption: `Confidence: ${Math.round(star.score * 100)}%`,
  };
}

function topGalleryPayload(stars) {
  return {
    title: "Top 5 Images",
    subtitle: "Most accurate matches in the current atlas",
    images: stars.map((star, index) => ({
      ...starToImage(star),
      label: `#${index + 1} ${star.name}`,
    })),
  };
}

function interpolateChannel(from, to, amount) {
  return Math.round(from + (to - from) * amount);
}

function interpolateRgb(from, to, amount) {
  return from.map((channel, index) =>
    interpolateChannel(channel, to[index], amount),
  );
}

function getRelevancePalette(score, theme = STAR_THEMES[0]) {
  const stops = theme.stops;
  const value = clamp(score, 0, 1);
  const upperIndex = stops.findIndex((stop) => value <= stop.at);
  const upper = stops[upperIndex === -1 ? stops.length - 1 : upperIndex];
  const lower = stops[Math.max(0, stops.indexOf(upper) - 1)];
  const span = Math.max(0.001, upper.at - lower.at);
  const amount = clamp((value - lower.at) / span, 0, 1);
  const core = interpolateRgb(lower.core, upper.core, amount);
  const glow = interpolateRgb(lower.glow, upper.glow, amount);

  return {
    core: core.join(", "),
    glow: glow.join(", "),
    border: core.map((channel) => Math.min(255, channel + 20)).join(", "),
  };
}

function StarView({
  images,
  cinematicMode = false,
}) {
  const [draftQuery, setDraftQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [selectedStarId, setSelectedStarId] = useState(null);
  const [rankedImages, setRankedImages] = useState(images || []);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [weakNoticeDismissed, setWeakNoticeDismissed] = useState(false);
  // null = still probing, true/false = CLIP backend availability. The atlas is
  // only usable when CLIP is available, so this gates the whole scene.
  const [clipAvailable, setClipAvailable] = useState(null);
  const [maxStars, setMaxStars] = useState(80);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState(null);
  const [hoveredStarId, setHoveredStarId] = useState(null);
  const [hoveredPosition, setHoveredPosition] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const { open: openFullscreen, close: closeFullscreen } = useFullscreenImage();
  const [selectedThemeId, setSelectedThemeId] = useState(DEFAULT_THEME_ID);
  // Nothing is drawn until a map has actually been built, so the scene never
  // shows a sky the user did not ask for.
  const [hasBuilt, setHasBuilt] = useState(false);
  // True only when the stars are ranked by CLIP. The lexical fallback scores on
  // a different scale, so WEAK_MATCH_SCORE would be meaningless against it.
  const [clipRanked, setClipRanked] = useState(false);
  // The map fills the window, so how much room a star really has depends on the
  // window's shape. Spacing and capacity are both computed from it.
  const [aspect, setAspect] = useState(() =>
    typeof window === "undefined" ? 9 / 16 : window.innerHeight / window.innerWidth,
  );
  const draggedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const cinematicTopImagesRef = useRef([]);

  useEffect(() => {
    const onResize = () => setAspect(window.innerHeight / window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const structureCapacity = useMemo(() => estimateSkyCapacity(aspect), [aspect]);

  const activeTheme = useMemo(
    () =>
      STAR_THEMES.find((theme) => theme.id === selectedThemeId) ??
      STAR_THEMES[0],
    [selectedThemeId],
  );
  const backgroundStars = useMemo(
    () => buildBackgroundStars(activeTheme),
    [activeTheme],
  );
  const backgroundClusters = useMemo(
    () => buildBackgroundClusters(activeTheme),
    [activeTheme],
  );
  const searchResultLimit = Math.max(1, Math.min(structureCapacity, 250));

  // Retry handler for the "CLIP offline" blocker: reset to probing, re-check.
  const probeClipHealth = useCallback(() => {
    setClipAvailable(null);
    checkClipHealth().then(setClipAvailable);
  }, []);

  useEffect(() => {
    let active = true;
    checkClipHealth().then((ok) => {
      if (active) {
        setClipAvailable(ok);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const runSearch = async () => {
      if (!activeQuery.trim()) {
        setRankedImages([]);
        setHasBuilt(false);
        setSearchError("");
        setClipRanked(false);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      setSearchError("");
      setWeakNoticeDismissed(false);
      try {
        const result = await semanticSearch(
          activeQuery,
          searchResultLimit,
        );
        if (!mounted) {
          return;
        }
        const hasResults = result.results.length > 0;
        setRankedImages(hasResults ? result.results : images || []);
        setHasBuilt(true);
        // An empty result set falls back to the unranked archive, which the
        // lexical scorer then scores - not a CLIP ranking either way.
        setClipRanked(result.clipUsed && hasResults);
        if (result.clipUsed) {
          setClipAvailable(true);
        }
      } catch {
        if (mounted) {
          setRankedImages(images || []);
          setHasBuilt(true);
          setSearchError("Backend unavailable, showing local map view.");
          setClipRanked(false);
          setClipAvailable(false);
        }
      } finally {
        if (mounted) {
          setIsSearching(false);
        }
      }
    };

    runSearch();
    return () => {
      mounted = false;
    };
  }, [activeQuery, images, searchResultLimit]);

  const availableStarCount = rankedImages.length;
  const sliderMax = Math.min(availableStarCount, structureCapacity);
  const renderedStarLimit = Math.min(maxStars, availableStarCount, sliderMax);

  const stars = useMemo(
    () =>
      hasBuilt && !isSearching
        ? buildStarLayout(rankedImages, activeQuery, renderedStarLimit, activeTheme, aspect)
        : [],
    [activeQuery, activeTheme, aspect, hasBuilt, isSearching, rankedImages, renderedStarLimit],
  );

  useEffect(() => {
    const timers = [];
    const schedule = (callback, delay) => {
      timers.push(window.setTimeout(callback, delay));
    };

    if (!cinematicMode) {
      return () => {
        timers.forEach((timerId) => window.clearTimeout(timerId));
      };
    }

    const query = CINEMATIC_QUERY;

    schedule(() => {
      setDraftQuery("");
      setActiveQuery("");
      setSelectedStarId(null);
      setShowSettings(false);
      closeFullscreen();
      setSelectedThemeId(DEFAULT_THEME_ID);
      setMaxStars(80);
      setZoom(1);
      setPanOffset({ x: 0, y: 0 });
    }, 0);

    query.split("").forEach((_, index) => {
      schedule(() => {
        setDraftQuery(query.slice(0, index + 1));
      }, 2800 + index * 760);
    });

    schedule(() => {
      setActiveQuery(query);
    }, 6200);

    schedule(() => {
      setShowSettings(true);
      setMaxStars(12);
    }, 13200);

    schedule(() => {
      setMaxStars(36);
    }, 19800);

    schedule(() => {
      setSelectedThemeId("ghost-ocean");
    }, 35600);

    schedule(() => {
      const featuredImage = cinematicTopImagesRef.current[0];
      if (featuredImage) {
        openFullscreen({ images: [starToImage(featuredImage)] });
      }
    }, 41600);

    schedule(() => {
      const topImages = cinematicTopImagesRef.current;
      if (topImages.length) {
        openFullscreen(topGalleryPayload(topImages));
      }
    }, 46600);

    return () => {
      timers.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [cinematicMode, openFullscreen, closeFullscreen]);

  const bestMatch = stars[0];
  // Only meaningful once a CLIP-ranked sky is actually on screen.
  const weakMatch =
    clipRanked &&
    !isSearching &&
    stars.length > 0 &&
    bestMatch.score < WEAK_MATCH_SCORE;
  const activeSelectedId =
    selectedStarId && stars.some((star) => star.id === selectedStarId)
      ? selectedStarId
      : (bestMatch?.id ?? null);
  const selectedStar =
    stars.find((star) => star.id === activeSelectedId) ?? bestMatch ?? null;
  const topMatches = stars.slice(0, 5);
  const topImageMatches = topMatches.filter((star) => star.imageUrl).slice(0, 5);
  const hoveredStar = stars.find((star) => star.id === hoveredStarId);

  useEffect(() => {
    cinematicTopImagesRef.current = topImageMatches;
  }, [topImageMatches]);

  const shapeLinks = useMemo(() => {
    const threshold =
      stars.length < 12
        ? 48
        : stars.length < 24
          ? 28
          : stars.length < 80
            ? 18
            : 13;
    return buildProximityLinks(stars, { neighbors: 1, threshold });
  }, [stars]);

  const mapTransform = `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`;

  const handlePointerDown = (event) => {
    if (event.button !== 0) {
      return;
    }
    if (
      event.target.closest("input") ||
      (event.target.closest("button") &&
        !event.target.closest(`.${styles.starNode}`))
    ) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    draggedRef.current = false;
    setPanStart({
      x: event.clientX,
      y: event.clientY,
      baseX: panOffset.x,
      baseY: panOffset.y,
    });
  };

  const handlePointerMove = (event) => {
    if (!panStart) {
      return;
    }
    const dx = event.clientX - panStart.x;
    const dy = event.clientY - panStart.y;
    if (Math.hypot(dx, dy) > 4) {
      draggedRef.current = true;
    }
    setPanOffset({
      x: panStart.baseX + dx,
      y: panStart.baseY + dy,
    });
  };

  const handlePointerUp = (event) => {
    if (!panStart) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (draggedRef.current) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    setPanStart(null);
  };

  const handleWheel = (event) => {
    event.preventDefault();
    const nextZoom = clamp(zoom - event.deltaY * 0.001, 0.5, 2.5);
    setZoom(nextZoom);
  };

  return (
    <div
      className={`${styles.starRoot} ${styles[activeTheme.className] || ""} ${cinematicMode ? styles.cinematicMode : ""}`}
      style={{
        "--space-base": activeTheme.base,
        "--space-nebula-one": activeTheme.nebulaOne,
        "--space-nebula-two": activeTheme.nebulaTwo,
        "--space-nebula-three": activeTheme.nebulaThree,
        "--space-accent": activeTheme.accent,
        "--space-panel": activeTheme.panel,
      }}
    >
      <div className={styles.nebulaLayer} />
      <div className={styles.spaceLightLayer} aria-hidden="true">
        {backgroundClusters.map((cluster) => (
          <span
            key={cluster.id}
            className={styles.spaceLightCluster}
            style={{
              left: `${cluster.x}%`,
              top: `${cluster.y}%`,
              width: `${cluster.size}px`,
              height: `${cluster.size}px`,
              "--cluster-color": cluster.color,
              "--cluster-base-opacity": cluster.opacity,
            }}
          />
        ))}
        <span className={styles.cometStreakOne} />
        <span className={styles.cometStreakTwo} />
        <span className={styles.cometStreakThree} />
        <span className={styles.distantGlowOne} />
        <span className={styles.distantGlowTwo} />
      </div>
      <div className={styles.backgroundStarLayer} aria-hidden="true">
        {backgroundStars.map((star) => (
          <span
            key={star.id}
            className={styles.backgroundStar}
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: `${star.size}px`,
              height: `${star.size}px`,
              "--base-opacity": star.opacity,
              background: star.tint,
              filter: star.blur ? `blur(${star.blur}px)` : "none",
              "--star-halo": `${star.halo}px`,
              animationDuration: `${star.twinkle}s`,
              animationDelay: `${star.delay}s`,
            }}
          />
        ))}
      </div>
      <div className={styles.galaxyBand} aria-hidden="true" />
      <div className={styles.orbitLayer} />

      <div className={styles.topPanel}>
        <form
          className={styles.queryBar}
          onSubmit={(event) => {
            event.preventDefault();
            setActiveQuery(draftQuery.trim());
          }}
        >
          <input
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="Type a word to reveal matching images"
            className={styles.queryInput}
          />
          <button
            type="submit"
            className={styles.searchButton}
            disabled={isSearching}
          >
            {isSearching ? "Building..." : "Build Star Map"}
          </button>
        </form>

        <div
          className={styles.querySuggestions}
          aria-label="Suggested CLIP searches"
        >
          <span className={styles.suggestionLabel}>Try CLIP:</span>
          {CLIP_PROMPT_SUGGESTIONS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className={styles.suggestionButton}
              onClick={() => {
                setDraftQuery(prompt);
                setActiveQuery(prompt);
              }}
            >
              {prompt}
            </button>
          ))}
        </div>

        {searchError ? (
          <div className={styles.searchError}>{searchError}</div>
        ) : null}

      </div>

      {weakMatch && !weakNoticeDismissed ? (
        <div className={styles.noticeLayer}>
          <div className={styles.searchNotice} role="status">
            <span className={styles.noticeIcon} aria-hidden="true">
              ✦
            </span>
            <div>
              <p className={styles.noticeTitle}>The sky came back flat</p>
              <p className={styles.noticeText}>{WEAK_MATCH_NOTICE}</p>
            </div>
            <button
              type="button"
              className={styles.noticeDismiss}
              onClick={() => setWeakNoticeDismissed(true)}
              aria-label="Dismiss this notice"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      <div className={styles.metaRow}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Constellation:</span>
          <span className={styles.metaValue}>
            {stars.length} of {availableStarCount} images
          </span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Best Match:</span>
          <span className={styles.metaValue}>
            {bestMatch ? `${Math.round(bestMatch.score * 100)}%` : "n/a"}
          </span>
        </div>

      </div>

      <div
        className={styles.starCanvas}
        style={{
          transform: mapTransform,
          transformOrigin: "50% 50%",
          cursor: panStart ? "grabbing" : "grab",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
      >
        <div className={styles.centerAnchor} />
        {!isSearching ? (
          <div className={styles.centerWord}>
            {activeQuery || "Type a word to see images"}
          </div>
        ) : null}

        <div
          className={`${styles.mapContents} ${isSearching ? styles.mapContentsBuilding : ""}`}
        >
          <svg
            className={styles.constellationSvg}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
          <circle className={styles.orbitGuide} cx="50" cy="50" r="13" />
          <circle className={styles.orbitGuide} cx="50" cy="50" r="28" />
          <circle className={styles.orbitGuide} cx="50" cy="50" r="42" />
          {shapeLinks.map((link) => (
            <line
              key={link.id}
              className={styles.constellationSpineLine}
              x1={link.from.x}
              y1={link.from.y}
              x2={link.to.x}
              y2={link.to.y}
              style={{
                opacity: link.opacity,
                stroke: `rgba(${link.from.color?.glow || "190, 220, 255"}, 0.68)`,
              }}
            />
          ))}
        </svg>

        {stars.map((star) => {
          // Keep the pointer target close to the visible star so neighbouring
          // stars' large glow boxes can't swallow the hover and leave a stale
          // preview showing.
          const hitSize = Math.round(Math.max(15, Math.min(star.size, 26)));
          return (
            <div
              key={star.id}
              className={`${styles.starNode} ${selectedStar?.id === star.id ? styles.starNodeSelected : ""}`}
              style={{
                left: `${star.x}%`,
                top: `${star.y}%`,
                width: `${star.size}px`,
                height: `${star.size}px`,
                "--hit-size": `${hitSize}px`,
                "--brightness": star.brightness,
                "--blur": `${star.blur}px`,
                "--glow": star.glow,
                "--star-core": star.color.core,
                "--star-glow": star.color.glow,
                "--star-color": `rgb(${star.color.core})`,
                "--star-glow-color": `rgb(${star.color.glow})`,
                "--star-aura-color": `rgba(${star.color.glow}, ${Math.min(0.95, star.auraAlpha + 0.28)})`,
                "--rankBoost": star.rankBoost,
                "--auraAlpha": star.auraAlpha,
                "--auraSize": `${star.auraSize}%`,
                "--colorWashSize": `${star.colorWashSize}%`,
                "--glowSize": `${star.glowSize}%`,
                "--sparkSize": `${star.sparkSize}%`,
                "--shimmerDuration": `${star.shimmerDuration}s`,
                "--shimmerDelay": `${star.shimmerDelay}s`,
              }}
            >
              <div className={styles.starAura} />
              <div className={styles.starColorWash} />
              <div className={styles.starGlow} />
              <div className={styles.starCore} />
              <div className={styles.starSpark} />
              <button
                type="button"
                className={styles.starHit}
                title={`${star.name} - ${Math.round(star.score * 100)}% similarity`}
                aria-label={star.name}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  if (suppressClickRef.current) {
                    return;
                  }
                  setSelectedStarId(star.id);
                  if (star.imageUrl)
                    openFullscreen({ images: [starToImage(star)] });
                }}
                onMouseEnter={(event) => {
                  setHoveredStarId(star.id);
                  setHoveredPosition({ x: event.clientX, y: event.clientY });
                }}
                onMouseMove={(event) => {
                  setHoveredStarId(star.id);
                  setHoveredPosition({ x: event.clientX, y: event.clientY });
                }}
                onMouseLeave={() => {
                  setHoveredStarId((current) =>
                    current === star.id ? null : current,
                  );
                  setHoveredPosition(null);
                }}
              />
            </div>
          );
          })}
        </div>

        {isSearching ? (
          <div className={styles.buildingLayer} aria-live="polite">
            <div className={styles.buildingStars}>
              {Array.from({ length: 8 }).map((_, index) => (
                <span
                  key={index}
                  className={styles.buildingStar}
                  style={{ "--i": index }}
                />
              ))}
            </div>
            <span className={styles.buildingText}>
              Charting the constellation…
            </span>
          </div>
        ) : null}
      </div>

      <div className={styles.mapHint}>
        Drag to pan - Scroll to zoom
      </div>

      <AnimatePresence>
        {hoveredStar && hoveredStar.imageUrl && hoveredPosition ? (
          <MotionDiv
            className={styles.starHoverPreview}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
            style={{
              left: hoveredPosition.x,
              top: hoveredPosition.y,
            }}
          >
            <img
              src={hoveredStar.imageUrl}
              alt={hoveredStar.name}
              className={styles.starHoverImage}
            />
            <div className={styles.starHoverLabel}>
              <div className={styles.starHoverName}>{hoveredStar.name}</div>
              <div className={styles.starHoverScore}>
                {Math.round(hoveredStar.score * 100)}%
              </div>
            </div>
          </MotionDiv>
        ) : null}
      </AnimatePresence>

      <div className={styles.settingsPanel}>
        <button
          type="button"
          className={styles.settingsButton}
          onClick={() => setShowSettings(!showSettings)}
          title="Settings"
        >
          ⚙️
        </button>

        <AnimatePresence>
          {showSettings ? (
            <MotionDiv
              className={styles.settingsDropdown}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
            >
              <div className={styles.settingGroup}>
                <label className={styles.settingLabel}>
                  <span>Theme: {activeTheme.name}</span>
                  <select
                    className={styles.structureSelect}
                    value={selectedThemeId}
                    onChange={(event) => setSelectedThemeId(event.target.value)}
                  >
                    {STAR_THEMES.map((theme) => (
                      <option key={theme.id} value={theme.id}>
                        {theme.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className={styles.settingGroup}>
                <label className={styles.settingLabel}>
                  <span>
                    Show {renderedStarLimit} of {availableStarCount} images
                  </span>
                  <input
                    type="range"
                    min={sliderMax > 0 ? 1 : 0}
                    max={Math.max(sliderMax, 1)}
                    step="1"
                    value={renderedStarLimit}
                    onChange={(e) => setMaxStars(Number(e.target.value))}
                    className={styles.settingSlider}
                    disabled={availableStarCount === 0}
                  />
                  <span className={styles.capacityNote}>
                    Sky holds {sliderMax} readable stars
                  </span>
                </label>
              </div>

              <div className={styles.settingGroup}>
                <button
                  type="button"
                  className={styles.settingReset}
                  onClick={() => {
                    setMaxStars(Math.min(80, Math.max(sliderMax, 1)));
                    setZoom(1);
                    setPanOffset({ x: 0, y: 0 });
                  }}
                >
                  Reset
                </button>
              </div>

            </MotionDiv>
          ) : null}
        </AnimatePresence>
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => openFullscreen(topGalleryPayload(topImageMatches))}
          disabled={!topImageMatches.length}
        >
          Open Top 5 Images
        </button>
      </div>

      {!cinematicMode && clipAvailable === false ? (
        <div className={styles.clipBlocker} role="alertdialog" aria-modal="true">
          <div className={styles.clipBlockerCard}>
            <span className={styles.clipBlockerBadge}>CLIP offline</span>
            <h2 className={styles.clipBlockerTitle}>Star atlas unavailable</h2>
            <p className={styles.clipBlockerText}>
              The atlas needs the CLIP model running on the backend to rank
              images. Start the backend and load CLIP, then try again.
            </p>
            <button
              type="button"
              className={styles.clipBlockerButton}
              onClick={probeClipHealth}
            >
              Retry connection
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default StarView;
