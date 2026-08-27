import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import SceneNavigator from "./components/shared/SceneNavigator";
import SceneLoader from "./components/shared/SceneLoader";
import PipelineProgressBar from "./components/shared/PipelineProgressBar";
import FullscreenImageProvider from "./components/shared/FullscreenImage";
import { listImages, setCurrentDatabase } from "./api/imageApi";
import { listDatabases } from "./api/databaseApi";
import { getPipelineStatus, runPipelines } from "./api/pipelineApi";
import styles from "./App.module.css";

const MotionDiv = motion.div;
const IslandTelescope = lazy(() => import("./components/scenes/IslandTelescope"));
const Hallway = lazy(() => import("./components/scenes/Hallway"));
const Room = lazy(() => import("./components/scenes/Room"));
const ShipExterior = lazy(() => import("./components/scenes/ShipExterior"));
const StarView = lazy(() => import("./components/features/f1/StarView"));
const HistoryTable = lazy(() => import("./components/features/f5/HistoryTable"));
const LogbookGallery = lazy(
  () => import("./components/features/f2/LogbookGallery"),
);
const CreativityCurrents = lazy(
  () => import("./components/features/f3/CreativityCurrents"),
);
const InfluenceRoutes = lazy(() => import("./components/features/f4/InfluenceRoutes"));
const CaptainsQuarters = lazy(() => import("./components/features/f6/CaptainsQuarters"));

const SCENES = {
  SHIP: "ship-exterior",
  HALLWAY: "hallway",
  ROOM: "chest-room",
  CANNON: "cannon-shot",
  ISLAND: "island-telescope",
  STARS: "star-view",
  F2: "logbook-gallery",
  F3: "creativity-currents",
  F4: "influence-routes",
  F5: "f5-history-map",
  F6: "captains-quarters",
};

const SCENE_ITEMS = [
  {
    id: SCENES.SHIP,
    label: "Ship Deck",
    hint: "Exterior approach",
  },
  {
    id: SCENES.HALLWAY,
    label: "Hallway",
    hint: "Door hub",
  },
  {
    id: SCENES.ROOM,
    label: "Chest Room",
    hint: "Load archive",
  },
  {
    id: SCENES.CANNON,
    label: "Cannon Flight",
    hint: "Travel sequence",
  },
  {
    id: SCENES.ISLAND,
    label: "Island Telescope",
    hint: "Moonlit lookout",
  },
  {
    id: SCENES.STARS,
    label: "Star Atlas",
    hint: "Mongo F1 map",
  },
  {
    id: SCENES.F2,
    label: "Logbook Gallery",
    hint: "Classifier logbook",
  },
  {
    id: SCENES.F3,
    label: "Creativity Currents",
    hint: "Originality over time",
  },
  {
    id: SCENES.F4,
    label: "Influence Routes",
    hint: "Directed visual links",
  },
  {
    id: SCENES.F5,
    label: "Chart Table",
    hint: "Navigator's history table",
  },
  {
    id: SCENES.F6,
    label: "Captain's Quarters",
    hint: "1640 archive filters",
  },
];

const sceneTransition = {
  duration: 0.62,
  ease: [0.22, 0.61, 0.36, 1],
};

const PIPELINE_LABELS = {
  f1: "F1 CLIP",
  f2: "F2 Logbook",
  f5: "F5 History",
  f6: "F6 Attributes",
};

const PIPELINE_NAMES = Object.keys(PIPELINE_LABELS);
const SELECTED_DATABASE_STORAGE_KEY = "warden-ship:selected-database";
const SHOWCASE_MIN_IMAGE_COUNT = 100;
const SHOWCASE_TARGET_IMAGE_COUNT = 1000;
const SHOWCASE = {
  DECK: "deck-orbit",
  ARCHIVE: "archive-load",
  BROADSIDE: "broadside-turn",
  CANNON: "cannon-flight",
  ISLAND: "island-dolly",
  STARS: "star-atlas",
};

// Keep the tour patient and make later editing a one-place change.
const SHOWCASE_TIMINGS = {
  [SHOWCASE.DECK]: 56000,
  [SHOWCASE.ARCHIVE]: 16000,
  [SHOWCASE.BROADSIDE]: 10000,
  [SHOWCASE.ISLAND]: 24000,
  [SHOWCASE.STARS]: 52000,
};

const SHOWCASE_COPY = {
  [SHOWCASE.DECK]: {
    title: "The Warden",
    detail: "An exterior survey through the painted tide",
  },
  [SHOWCASE.ARCHIVE]: {
    title: "Archive Hold",
    detail: "Loading a collection into the chest room",
  },
  [SHOWCASE.BROADSIDE]: {
    title: "Gun Deck",
    detail: "Turning starboard for the broadside",
  },
  [SHOWCASE.CANNON]: {
    title: "Crossing",
    detail: "Following the signal over open water",
  },
  [SHOWCASE.ISLAND]: {
    title: "Lookout Island",
    detail: "A low moonlit pass toward the telescope",
  },
  [SHOWCASE.STARS]: {
    title: "Star Atlas",
    detail: "Searching, ranking, and reshaping the collection",
  },
};

function isTypingTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  return (
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.closest("[contenteditable='true']") !== null
  );
}

function ShowcaseOverlay({ cue, onStop }) {
  const copy = SHOWCASE_COPY[cue];
  const showOverlay =
    cue === SHOWCASE.DECK ||
    cue === SHOWCASE.ARCHIVE ||
    cue === SHOWCASE.BROADSIDE;
  if (!copy || !showOverlay) {
    return null;
  }

  return (
    <div className={styles.showcaseOverlay}>
      <div className={styles.showcaseTitle}>
        <span>Cinematic Tour</span>
        <strong>{copy.title}</strong>
        <small>{copy.detail}</small>
      </div>
      <button type="button" className={styles.showcaseExit} onClick={onStop}>
        Esc / Exit Tour
      </button>
    </div>
  );
}

function getStoredDatabase() {
  if (typeof window === "undefined") return "default";

  try {
    return (
      window.localStorage.getItem(SELECTED_DATABASE_STORAGE_KEY) || "default"
    );
  } catch {
    return "default";
  }
}

function getInitialScene() {
  if (typeof window === "undefined") return SCENES.SHIP;

  const sceneParam = new URLSearchParams(window.location.search)
    .get("scene")
    ?.toLowerCase();
  const sceneAliases = {
    f6: SCENES.F6,
    "captains-quarters": SCENES.F6,
    attributes: SCENES.F6,
    f5: SCENES.F5,
    history: SCENES.F5,
    stars: SCENES.STARS,
    atlas: SCENES.STARS,
    room: SCENES.ROOM,
    ship: SCENES.SHIP,
    hallway: SCENES.HALLWAY,
    hall: SCENES.HALLWAY,
  };

  return sceneAliases[sceneParam] || SCENES.SHIP;
}

function storeDatabase(dbName) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SELECTED_DATABASE_STORAGE_KEY, dbName);
  } catch {
    // Continue with in-memory selection when storage is unavailable.
  }
}

async function findShowcaseDataset(preferredName) {
  const result = await listDatabases();
  const databases = [...(result.databases || [])].sort(
    (left, right) =>
      Number(right.image_count || 0) - Number(left.image_count || 0),
  );
  const eligible = databases.filter(
    (database) => Number(database.image_count || 0) >= SHOWCASE_MIN_IMAGE_COUNT,
  );
  const fullArchiveCandidates = eligible.filter(
    (database) =>
      Number(database.image_count || 0) >= SHOWCASE_TARGET_IMAGE_COUNT,
  );
  const preferred = eligible.find(
    (database) => database.name === preferredName,
  );
  const candidates =
    fullArchiveCandidates.length > 0
      ? [
          ...fullArchiveCandidates,
          ...eligible.filter(
            (database) =>
              Number(database.image_count || 0) < SHOWCASE_TARGET_IMAGE_COUNT,
          ),
        ]
      : preferred
        ? [
            preferred,
            ...eligible.filter((database) => database.name !== preferred.name),
          ]
        : eligible;
  const attempted = new Set();
  let fallback = null;

  for (const database of candidates) {
    attempted.add(database.name);
    try {
      const images = await listImages(1000, database.name);
      if (
        images.length >= SHOWCASE_TARGET_IMAGE_COUNT ||
        (fullArchiveCandidates.length === 0 &&
          images.length >= SHOWCASE_MIN_IMAGE_COUNT)
      ) {
        return { databaseName: database.name, images };
      }
      if (images.length > (fallback?.images.length || 0)) {
        fallback = { databaseName: database.name, images };
      }
    } catch {
      // Try another archive when database metadata is stale or unavailable.
    }
  }

  for (const database of databases) {
    if (attempted.has(database.name)) {
      continue;
    }

    try {
      const images = await listImages(1000, database.name);
      if (
        images.length >= SHOWCASE_TARGET_IMAGE_COUNT ||
        (fullArchiveCandidates.length === 0 &&
          images.length >= SHOWCASE_MIN_IMAGE_COUNT)
      ) {
        return { databaseName: database.name, images };
      }
      if (images.length > (fallback?.images.length || 0)) {
        fallback = { databaseName: database.name, images };
      }
    } catch {
      // Leave a broken archive out of the cinematic selection.
    }
  }

  return fallback;
}

function normalizePipelineStatus(status) {
  return PIPELINE_NAMES.map((pipelineName) => {
    const pipelineState = status[pipelineName] || {};
    const rawStatus = pipelineState.status || "idle";
    const progress = Number(
      pipelineState.progress ?? (rawStatus === "completed" ? 100 : 0),
    );

    return {
      name: PIPELINE_LABELS[pipelineName],
      pipelineName,
      status: rawStatus,
      progress: clampProgress(progress),
      error: pipelineState.error || "",
      message: pipelineState.message || "",
      stage: pipelineState.stage || rawStatus,
      canUse: Boolean(pipelineState.can_use),
    };
  });
}

function clampProgress(value) {
  const progress = Number(value);
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, progress));
}

function SceneLoadingFallback() {
  return <SceneLoader messageKey="scene" />;
}

function App() {
  const [appState, setAppState] = useState("idle");
  const [fileName, setFileName] = useState("");
  const [scene, setScene] = useState(() => getInitialScene());
  const [uploadedImages, setUploadedImages] = useState([]);
  const [pipelineProgress, setPipelineProgress] = useState([]);
  const [selectedDatabase, setSelectedDatabase] = useState(() =>
    getStoredDatabase(),
  );
  const [suppressTransition, setSuppressTransition] = useState(false);
  const [isFiringCannons, setIsFiringCannons] = useState(false);
  const [ballArriving, setBallArriving] = useState(false);
  const [fadeToBlack, setFadeToBlack] = useState(false);
  const [showcaseCue, setShowcaseCue] = useState(null);
  const transitionTimersRef = useRef([]);
  const showcaseTimerRef = useRef(null);
  const showcaseLaunchRef = useRef(0);

  useEffect(() => {
    let isMounted = true;
    setCurrentDatabase(selectedDatabase);
    const fetchImages = async () => {
      try {
        const images = await listImages(1000, selectedDatabase);
        if (isMounted) {
          setUploadedImages(images);
        }
      } catch {
        if (isMounted) {
          setUploadedImages([]);
        }
      }
    };

    fetchImages();
    return () => {
      isMounted = false;
    };
  }, [selectedDatabase]);

  const handleRetryPipeline = useCallback(
    async (pipelineName) => {
      try {
        await runPipelines([pipelineName], selectedDatabase);
      } catch (error) {
        console.error("Retry failed:", error);
      }
    },
    [selectedDatabase],
  );

  useEffect(() => {
    let isMounted = true;

    const syncPipelineProgress = async () => {
      try {
        const status = await getPipelineStatus(PIPELINE_NAMES);
        if (isMounted) {
          setPipelineProgress(normalizePipelineStatus(status));
        }
      } catch {
        if (isMounted) {
          setPipelineProgress([]);
        }
      }
    };

    syncPipelineProgress();
    const intervalId = window.setInterval(syncPipelineProgress, 1500);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const clearTransitionTimers = useCallback(() => {
    transitionTimersRef.current.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    transitionTimersRef.current = [];
  }, []);

  const clearShowcaseTimer = useCallback(() => {
    if (showcaseTimerRef.current !== null) {
      window.clearTimeout(showcaseTimerRef.current);
      showcaseTimerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      clearTransitionTimers();
      clearShowcaseTimer();
    },
    [clearShowcaseTimer, clearTransitionTimers],
  );

  const handleFireCannons = useCallback(() => {
    if (isFiringCannons) return;
    setSuppressTransition(true);
    setIsFiringCannons(true);
  }, [isFiringCannons]);

  const handleSceneChange = useCallback(
    (nextScene) => {
      if (nextScene === scene) return;
      if (nextScene !== SCENES.ISLAND && ballArriving) {
        setBallArriving(false);
      }
      if (nextScene === SCENES.ISLAND || nextScene === SCENES.CANNON) {
        if (!isFiringCannons) {
          if (scene !== SCENES.ROOM) {
            setScene(SCENES.ROOM);
          }
          handleFireCannons();
        }
        return;
      }
      setScene(nextScene);
    },
    [ballArriving, handleFireCannons, isFiringCannons, scene],
  );

  const handleCannonSequenceComplete = useCallback(() => {
    if (fadeToBlack) return;
    clearTransitionTimers();
    setFadeToBlack(true);
    const switchTimer = window.setTimeout(() => {
      setScene(SCENES.ISLAND);
      setBallArriving(true);
      setIsFiringCannons(false);
      setSuppressTransition(false);
      if (showcaseCue === SHOWCASE.CANNON) {
        setShowcaseCue(SHOWCASE.ISLAND);
      }

      const fadeOutTimer = window.setTimeout(() => {
        setFadeToBlack(false);
      }, 500);
      transitionTimersRef.current.push(fadeOutTimer);
    }, 900);

    transitionTimersRef.current.push(switchTimer);
  }, [clearTransitionTimers, fadeToBlack, showcaseCue]);

  const handleArrivalComplete = useCallback(() => {
    setBallArriving(false);
  }, []);

  const stopShowcase = useCallback(() => {
    showcaseLaunchRef.current += 1;
    clearShowcaseTimer();
    clearTransitionTimers();
    setShowcaseCue(null);
    setFadeToBlack(false);
    setSuppressTransition(false);
    setIsFiringCannons(false);
    setBallArriving(false);
  }, [clearShowcaseTimer, clearTransitionTimers]);

  const startShowcase = useCallback(async () => {
    const launchId = showcaseLaunchRef.current + 1;
    showcaseLaunchRef.current = launchId;
    clearShowcaseTimer();
    clearTransitionTimers();
    setFadeToBlack(false);
    setSuppressTransition(false);
    setIsFiringCannons(false);
    setBallArriving(false);
    setScene(SCENES.SHIP);

    try {
      const selected = await findShowcaseDataset(selectedDatabase);
      if (launchId !== showcaseLaunchRef.current) {
        return;
      }
      if (selected) {
        setCurrentDatabase(selected.databaseName);
        storeDatabase(selected.databaseName);
        setSelectedDatabase(selected.databaseName);
        setUploadedImages(selected.images);
      }
    } catch {
      // The tour still works offline with any images already loaded.
    }

    if (launchId !== showcaseLaunchRef.current) {
      return;
    }
    setShowcaseCue(SHOWCASE.DECK);
  }, [clearShowcaseTimer, clearTransitionTimers, selectedDatabase]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (isTypingTarget(event.target)) {
        return;
      }

      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        if (showcaseCue) {
          stopShowcase();
        } else {
          void startShowcase();
        }
      } else if (event.key === "Escape" && showcaseCue) {
        event.preventDefault();
        stopShowcase();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showcaseCue, startShowcase, stopShowcase]);

  useEffect(() => {
    clearShowcaseTimer();
    if (!showcaseCue || showcaseCue === SHOWCASE.CANNON) {
      return undefined;
    }

    const duration = SHOWCASE_TIMINGS[showcaseCue];
    if (!duration) {
      return undefined;
    }

    showcaseTimerRef.current = window.setTimeout(() => {
      switch (showcaseCue) {
        case SHOWCASE.DECK:
          setScene(SCENES.ROOM);
          setShowcaseCue(SHOWCASE.ARCHIVE);
          break;
        case SHOWCASE.ARCHIVE:
          setShowcaseCue(SHOWCASE.BROADSIDE);
          break;
        case SHOWCASE.BROADSIDE:
          setShowcaseCue(SHOWCASE.CANNON);
          handleFireCannons();
          break;
        case SHOWCASE.ISLAND:
          setBallArriving(false);
          setScene(SCENES.STARS);
          setShowcaseCue(SHOWCASE.STARS);
          break;
        case SHOWCASE.STARS:
          setShowcaseCue(null);
          break;
        default:
          break;
      }
    }, duration);

    return clearShowcaseTimer;
  }, [clearShowcaseTimer, handleFireCannons, showcaseCue]);

  const motionSuppressed = suppressTransition || fadeToBlack;

  return (
    <FullscreenImageProvider>
    <div
      className={`${styles.appRoot} ${showcaseCue ? styles.showcaseActive : ""}`}
    >
      {!showcaseCue &&
      !isFiringCannons &&
      scene !== SCENES.F3 &&
      scene !== SCENES.F4 &&
      scene !== SCENES.F6 ? (
        <PipelineProgressBar
          pipelines={pipelineProgress}
          onRetry={handleRetryPipeline}
        />
      ) : null}

      {!showcaseCue && !isFiringCannons ? (
        <SceneNavigator
          scene={scene}
          sceneItems={SCENE_ITEMS}
          onSceneChange={handleSceneChange}
          uploadedCount={uploadedImages.length}
        />
      ) : null}

      <AnimatePresence mode="wait">
        <MotionDiv
          key={scene}
          className={styles.sceneStage}
          initial={
            motionSuppressed
              ? { opacity: 1, scale: 1, filter: "blur(0px)" }
              : { opacity: 0, scale: 0.985, filter: "blur(8px)" }
          }
          animate={
            motionSuppressed
              ? { opacity: 1, scale: 1, filter: "blur(0px)" }
              : { opacity: 1, scale: 1, filter: "blur(0px)" }
          }
          exit={
            motionSuppressed
              ? { opacity: 1, scale: 1, filter: "blur(0px)" }
              : { opacity: 0, scale: 1.015, filter: "blur(10px)" }
          }
          transition={motionSuppressed ? { duration: 0 } : sceneTransition}
        >
          <Suspense fallback={<SceneLoadingFallback />}>
            {scene === SCENES.SHIP ? (
              <ShipExterior
                uploadedCount={uploadedImages.length}
                onEnterWindow={() => setScene(SCENES.HALLWAY)}
                isFiringCannons={false}
                cinematicMode={showcaseCue === SHOWCASE.DECK}
              />
            ) : null}

            {scene === SCENES.HALLWAY ? (
              <Hallway
                onEnterRoom={() => setScene(SCENES.ROOM)}
                onOpenF2={() => setScene(SCENES.F2)}
                onOpenF3={() => setScene(SCENES.F3)}
                onOpenF4={() => setScene(SCENES.F4)}
                onOpenF5={() => setScene(SCENES.F5)}
                onOpenF6={() => setScene(SCENES.F6)}
              />
            ) : null}

            {scene === SCENES.ROOM ? (
              isFiringCannons ? (
                <ShipExterior
                  uploadedCount={uploadedImages.length}
                  onEnterWindow={() => setScene(SCENES.ROOM)}
                  isFiringCannons
                  onCannonSequenceComplete={handleCannonSequenceComplete}
                  cinematicMode={false}
                />
              ) : (
                <>
                  <Room
                    appState={appState}
                    setAppState={setAppState}
                    fileName={fileName}
                    setFileName={setFileName}
                    onFireCannons={handleFireCannons}
                    onImagesReady={setUploadedImages}
                    selectedDatabase={selectedDatabase}
                    onDatabaseChanged={setSelectedDatabase}
                    cinematicCue={showcaseCue}
                    isFiringCannons={isFiringCannons}
                  />
                  {isFiringCannons ? (
                    <div className={styles.cannonOverlay}>
                      <ShipExterior
                        uploadedCount={uploadedImages.length}
                        onEnterWindow={() => setScene(SCENES.ROOM)}
                        isFiringCannons
                        onCannonSequenceComplete={handleCannonSequenceComplete}
                        cinematicMode={false}
                      />
                    </div>
                  ) : null}
                </>
              )
            ) : null}

            {/* replaced by in-scene cannon animation — see ShipExterior isFiringCannons */}
            {/* {scene === SCENES.CANNON ? (
            <CannonFlight
              onArriveIsland={() => setScene(SCENES.ISLAND)}
              onBackToRoom={() => setScene(SCENES.ROOM)}
            />
          ) : null} */}

            {scene === SCENES.ISLAND ? (
              <IslandTelescope
                onLookThrough={() => setScene(SCENES.STARS)}
                onBackToRoom={() => setScene(SCENES.ROOM)}
                onBackToShip={() => setScene(SCENES.SHIP)}
                ballArriving={ballArriving}
                onArrivalComplete={handleArrivalComplete}
              />
            ) : null}

            {scene === SCENES.STARS ? (
              <StarView
                images={uploadedImages}
                cinematicMode={showcaseCue === SHOWCASE.STARS}
              />
            ) : null}

            {scene === SCENES.F2 ? (
              <LogbookGallery
                databaseName={selectedDatabase}
                images={uploadedImages}
              />
            ) : null}

            {scene === SCENES.F3 ? (
              <CreativityCurrents
                databaseName={selectedDatabase}
                onBackToHistory={() => setScene(SCENES.F5)}
              />
            ) : null}

            {scene === SCENES.F4 ? (
              <InfluenceRoutes
                databaseName={selectedDatabase}
                onBackToHistory={() => setScene(SCENES.F5)}
              />
            ) : null}

            {scene === SCENES.F5 ? (
              <HistoryTable
                images={uploadedImages}
                databaseName={selectedDatabase}
                onOpenCreativity={() => setScene(SCENES.F3)}
                onOpenInfluence={() => setScene(SCENES.F4)}
              />
            ) : null}

            {scene === SCENES.F6 ? (
              <CaptainsQuarters
                images={uploadedImages}
                databaseName={selectedDatabase}
              />
            ) : null}
          </Suspense>
          <div
            className={`${styles.sceneFade} ${fadeToBlack ? styles.sceneFadeActive : ""}`}
          />
        </MotionDiv>
      </AnimatePresence>
      <ShowcaseOverlay cue={showcaseCue} onStop={stopShowcase} />
    </div>
    </FullscreenImageProvider>
  );
}

export default App;
