import { useCallback, useEffect, useMemo, useState } from "react";
import { getPipelineStatus, runPipelines } from "../../../api/pipelineApi";
import {
  CAPTAINS_OBJECTS,
  COMPASS_SECTORS,
  LIGHTNESS_LEVELS,
  POSE_PRESETS,
  SATURATION_LEVELS,
  SWATCHES,
  WAVE_DIRECTIONS,
} from "../../../lib/f6Constants";
import {
  buildAvailability,
  buildColorStats,
  buildHueCounts,
  buildOptionCounts,
  buildLineStats,
  clamp,
  filterPaintings,
  normalizeRecords,
} from "../../../lib/f6Filters";
import useF6Data from "../../../hooks/useF6Data";
import { useFullscreenImage } from "../../shared/useFullscreenImage";
import { toFilterValues, useF6Filters } from "../../../hooks/useF6Filters";
import QuartersScene from "./scene/QuartersScene";
import NavigatorsGuide from "./ui/NavigatorsGuide";
import { BUILD_MESSAGES, LOADING_MESSAGES } from "../../../lib/uiCopy";
import styles from "./CaptainsQuarters.module.css";

const EMPTY_IMAGES = [];
const RUNNING_STATUSES = new Set(["running", "pending", "processing"]);
const MAX_DOCK_RESULTS = 150;

function nextFromList(list, current, delta) {
  const index = Math.max(0, list.indexOf(current));
  return list[(index + delta + list.length) % list.length];
}

function countActive(filters) {
  return Object.values(filters).filter((filter) => filter.active).length;
}

function previewIndexFromImages(images) {
  return (Array.isArray(images) ? images : []).map((image, index) => ({
    id: String(image.id || image.fileId || image.file_id || image.filename || `painting-${index + 1}`),
    path: image.filename || image.name || `painting-${index + 1}`,
    filename: image.filename || image.name || "",
    file_id: image.fileId || image.file_id || null,
    image_url: image.imageUrl || image.image_url || "",
    features: {
      meta: {
        title: image.title || image.metadata?.title || image.filename || `Painting ${index + 1}`,
        artist: image.artist || image.metadata?.artist || "",
        year: image.year || image.metadata?.year || null,
        movement: image.movement || image.metadata?.movement || "",
        region: image.region || image.origin || image.metadata?.region || image.metadata?.origin || "",
      },
    },
  }));
}

export default function CaptainsQuarters({
  images = EMPTY_IMAGES,
  databaseName = "default",
}) {
  const { rawIndex, loading, error, reload } = useF6Data(databaseName);
  const filtersStore = useF6Filters((state) => state.filters);
  const setFilter = useF6Filters((state) => state.setFilter);
  const clearFilter = useF6Filters((state) => state.clearFilter);
  const clearAll = useF6Filters((state) => state.clearAll);
  const setFocusedObject = useF6Filters((state) => state.setFocusedInstrument);

  const [guideOpen, setGuideOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
  const [tipIndex, setTipIndex] = useState(0);
  const [runDismissed, setRunDismissed] = useState(false);
  const [buildState, setBuildState] = useState({ status: "idle", progress: 0, message: "" });

  const filterValues = useMemo(() => toFilterValues(filtersStore), [filtersStore]);
  const previewIndex = useMemo(() => previewIndexFromImages(images), [images]);
  const featureDataReady = Array.isArray(rawIndex) && rawIndex.length > 0;
  const records = useMemo(
    () => normalizeRecords(featureDataReady ? rawIndex : previewIndex, images),
    [featureDataReady, images, previewIndex, rawIndex],
  );
  const hasArchiveData = featureDataReady;
  // Both halves are relative to the collection on the table: how many lines a
  // painting must carry to count as busy, and how saturated it must be to count
  // as vivid. Kept in one object so every filter call reads the same cutoffs.
  const collectionStats = useMemo(
    () => ({ ...buildLineStats(records), ...buildColorStats(records) }),
    [records],
  );
  const filteredRecords = useMemo(
    () => (featureDataReady ? filterPaintings(records, filterValues, collectionStats) : records),
    [featureDataReady, records, filterValues, collectionStats],
  );
  const availability = useMemo(() => buildAvailability(records), [records]);
  // Every count but the hues is measured over the whole collection: those
  // options are ORed inside their instrument, so what they hold does not change
  // as the board fills. Dyes are ANDed, so a cloth is counted over what survives
  // the current filters — pin teal and the other cloths drop to what teal leaves.
  const optionCounts = useMemo(
    () => ({
      ...buildOptionCounts(records, collectionStats),
      hues: buildHueCounts(filteredRecords),
    }),
    [records, filteredRecords, collectionStats],
  );
  const { open: openFullscreen } = useFullscreenImage();

  // Ledger thumbnails open the shared artwork viewer, same as the star atlas
  // and the chart table.
  const openRecord = useCallback(
    (record) => {
      if (!record?.imageUrl) return;
      const details = [record.year, record.movement, record.origin].filter(Boolean).join(" · ");
      openFullscreen({
        images: [
          {
            src: record.imageUrl,
            label: record.title,
            caption: [record.artist, details].filter(Boolean).join(" · "),
          },
        ],
      });
    },
    [openFullscreen],
  );
  const activeFilterCount = useMemo(() => countActive(filtersStore), [filtersStore]);

  const running = RUNNING_STATUSES.has(buildState.status);
  const showRunCard = !featureDataReady && !runDismissed;

  const tips = [
    "turn an instrument · matches update below instantly",
    "click the globe to choose an origin",
    "drag the dyer's beads to tune colour",
    "drag the carved head to seek a portrait pose",
  ];

  useEffect(() => {
    const interval = window.setInterval(() => setTipIndex((current) => current + 1), 4600);
    return () => window.clearInterval(interval);
  }, []);

  // --- F6 pipeline run + status polling --------------------------------
  const runF6 = useCallback(async () => {
    setBuildState({ status: "running", progress: 1, message: "Charting the captain's instruments" });
    try {
      await runPipelines("f6", databaseName);
    } catch (startError) {
      setBuildState({
        status: "failed",
        progress: 0,
        message: startError instanceof Error ? startError.message : "Could not start F6",
      });
    }
  }, [databaseName]);

  useEffect(() => {
    if (!running) return undefined;
    let mounted = true;
    let timerId: number | null = null;
    const poll = async () => {
      try {
        const status = await getPipelineStatus("f6");
        if (!mounted) return;
        const f6 = status.f6 || {};
        const nextStatus = f6.status || "running";
        setBuildState({
          status: nextStatus,
          progress: Number(f6.progress || 0),
          message: f6.message || "Reading the captain's instruments",
        });
        if (nextStatus === "completed") {
          reload();
          return;
        }
        if (nextStatus === "failed" || nextStatus === "cancelled") {
          return;
        }
      } catch {
        if (mounted) {
          setBuildState((current) => ({ ...current, message: "Waiting for the pipeline" }));
        }
      }
      if (mounted) timerId = window.setTimeout(poll, 1200);
    };
    timerId = window.setTimeout(poll, 350);
    return () => {
      mounted = false;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [running, databaseName, reload]);

  // --- keyboard control for the 3D instruments (accessibility) ---------
  const activateObject = (objectId) => {
    if (hasArchiveData && !availability[objectId]) return;
    if (filtersStore[objectId].active) {
      clearFilter(objectId);
      return;
    }
    if (objectId === "color") {
      // Start on the dye that actually holds the most paintings, and on nothing
      // else. The old default paired a fixed hue with a saturation and a
      // lightness band the user never chose; ANDed together those three
      // returned nothing for 10 of the 12 dyes, so the board looked broken.
      // Picking no hue at all is no better - the instrument would open having
      // filtered nothing, which reads as broken too.
      const hues = optionCounts?.hues || {};
      const busiest = SWATCHES.map(([, , hue]) => hue).reduce(
        (best, hue) => ((hues[hue] || 0) > (hues[best] || 0) ? hue : best),
        SWATCHES[0][2],
      );
      setFilter("color", { hues: [busiest], sat: null, light: null }, true);
    }
    if (objectId === "portrait") setFilter("portrait", { sector: "N", portraitsOnly: true }, true);
    if (objectId === "pose") setFilter("pose", "armsDown", true);
    if (objectId === "hough") setFilter("hough", { intensity: 5, directions: [] }, true);
  };

  const adjustObject = (objectId, key) => {
    if (hasArchiveData && !availability[objectId]) return;
    const delta = key === "ArrowLeft" || key === "ArrowDown" ? -1 : 1;
    if (objectId === "color") {
      const current = filtersStore.color.value;
      if (key === "ArrowLeft" || key === "ArrowRight") {
        // Step between dyes rather than nudging the hue by 0.05: a colour
        // belongs to its nearest dye, so a hue that sits between two of them
        // matches nothing at all. The arrows walk one dye at a time and replace
        // whatever is pinned — pinning several dyes is a pointer gesture, so
        // keyboard control keeps the single-dye stepping it had.
        const hues = SWATCHES.map(([, , hue]) => hue);
        const from = current.hues[current.hues.length - 1] ?? hues[0];
        setFilter("color", { ...current, hues: [nextFromList(hues, from, delta)] }, true);
      } else if (!current.hues.length) {
        // The bands qualify a pinned dye, so like the sliders on the board they
        // do nothing until there is one.
      } else if (key === "ArrowUp") {
        setFilter("color", { ...current, sat: nextFromList(SATURATION_LEVELS, current.sat || "medium", 1) }, true);
      } else {
        setFilter("color", { ...current, light: nextFromList(LIGHTNESS_LEVELS, current.light || "medium", -1) }, true);
      }
    }
    if (objectId === "portrait") {
      setFilter("portrait", { sector: nextFromList(COMPASS_SECTORS, filtersStore.portrait.value.sector || "N", delta), portraitsOnly: true }, true);
    }
    if (objectId === "pose") {
      const poses = POSE_PRESETS.map(([id]) => id);
      setFilter("pose", nextFromList(poses, filtersStore.pose.value || "armsDown", delta), true);
    }
    if (objectId === "hough") {
      const current = filtersStore.hough.value;
      if (key === "ArrowLeft" || key === "ArrowRight") {
        const directions = WAVE_DIRECTIONS.map(([id]) => id);
        setFilter("hough", { ...current, directions: [nextFromList(directions, current.directions[0] || "vertical", delta)] }, true);
      } else {
        setFilter("hough", { ...current, intensity: clamp((current.intensity ?? 5) + delta, 0, 10) }, true);
      }
    }
  };

  const handleKeyDown = (event, objectId) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateObject(objectId);
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      adjustObject(objectId, event.key);
    }
  };

  const dockResults = filteredRecords.slice(0, MAX_DOCK_RESULTS);

  return (
    <main className={styles.root} aria-label="Feature 6 Captain's Quarters">
      <QuartersScene
        filters={filtersStore}
        setFilter={setFilter}
        clearFilter={clearFilter}
        availability={availability}
        optionCounts={optionCounts}
        hasArchiveData={hasArchiveData}
        featureDataReady={featureDataReady}
      />

      {/* Top chrome */}
      <div className={styles.topNav}>
        <div className={styles.topNavRow}>
          <button
            type="button"
            className={`${styles.chromeButton} ${activeFilterCount ? "" : styles.chromeButtonGhost}`}
            onClick={clearAll}
            disabled={!activeFilterCount}
          >
            ⟲ Clear filters
          </button>
        </div>
        <div className={styles.datasetPill}>
          <span className={`${styles.datasetDot} ${featureDataReady ? "" : styles.datasetDotOffline}`} />
          <em>{databaseName}</em>
          <b>{featureDataReady ? `${records.length} indexed` : `${records.length} preview`}</b>
        </div>
      </div>

      <NavigatorsGuide open={guideOpen} onToggle={() => setGuideOpen((current) => !current)} />

      {/* Bottom results dock — updates live as instruments are turned */}
      <aside className={`${styles.resultDock} ${dockOpen ? styles.resultDockOpen : styles.resultDockClosed}`} aria-label="Matching paintings">
        <header className={styles.resultDockHeader}>
          <div className={styles.resultDockTitle}>
            <span>Ship&apos;s Ledger</span>
            <strong>
              {filteredRecords.length}
              <em> of {records.length} paintings</em>
            </strong>
            <small>
              {activeFilterCount
                ? `${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""} active`
                : "no filters yet — turn an instrument"}
            </small>
          </div>
          <button
            type="button"
            className={styles.resultDockToggle}
            onClick={() => setDockOpen((open) => !open)}
            aria-expanded={dockOpen}
          >
            {dockOpen ? "▾ Hide" : "▴ Results"}
          </button>
        </header>
        {dockOpen ? (
          <div className={styles.resultStrip}>
            {filteredRecords.length === 0 ? (
              <p className={styles.resultEmpty}>The hold is bare — ease a filter, Navigator.</p>
            ) : (
              dockResults.map((record) => (
                <figure key={record.key} className={styles.resultCard} title={`${record.title}${record.artist ? ` — ${record.artist}` : ""}`}>
                  {record.imageUrl ? (
                    <button
                      type="button"
                      className={styles.resultCardButton}
                      onClick={() => openRecord(record)}
                      aria-label={`Open ${record.title}`}
                    >
                      <img src={record.imageUrl} alt="" loading="lazy" />
                    </button>
                  ) : (
                    <span className={styles.resultNoImg} aria-hidden="true">⚓</span>
                  )}
                  <figcaption>
                    <strong>{record.title}</strong>
                    <span>{record.artist || "Unknown"}</span>
                  </figcaption>
                </figure>
              ))
            )}
            {filteredRecords.length > MAX_DOCK_RESULTS ? (
              <p className={styles.resultMore}>+{filteredRecords.length - MAX_DOCK_RESULTS} more</p>
            ) : null}
          </div>
        ) : null}
      </aside>

      {/* Run F6 prompt when this dataset has no attribute index yet */}
      {showRunCard ? (
        <div className={styles.runOverlay}>
          <div className={styles.runCard}>
            <span>Ship&apos;s Log</span>
            <h2>{running ? BUILD_MESSAGES.captains : "This archive has no attribute index"}</h2>
            <p>
              {running
                ? "The crew is reading every painting's colour, mood, bodies and line-work. The cabin will fill as it finishes."
                : images.length
                  ? `${images.length} paintings are aboard, but F6 has not yet measured their attributes. Run F6 to make the instruments respond — or explore the empty cabin first.`
                  : "No paintings are loaded for this dataset yet. Run F6 to build the attribute index, or explore the cabin to learn the instruments."}
            </p>
            {running ? (
              <div className={styles.runProgress}>
                <div>
                  <span>{buildState.message}</span>
                  <strong>{Math.round(Number(buildState.progress || 0))}%</strong>
                </div>
                <progress max="100" value={Number(buildState.progress || 0)} />
              </div>
            ) : null}
            {buildState.status === "failed" ? (
              <p className={styles.runError}>{buildState.message}</p>
            ) : null}
            <div className={styles.topNavRow}>
              <button type="button" className={styles.runButton} onClick={runF6} disabled={running}>
                {running ? "Running F6…" : "Run F6 analysis"}
              </button>
              <button type="button" className={styles.chromeButton} onClick={() => setRunDismissed(true)} disabled={running}>
                Explore the cabin
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Hidden keyboard controls for accessibility */}
      <div className={styles.keyboardNav} aria-label="Keyboard controls for captain's quarters">
        {CAPTAINS_OBJECTS.map((object) => (
          <button
            key={object.id}
            type="button"
            disabled={hasArchiveData && !availability[object.id]}
            aria-label={`${object.name}${hasArchiveData && !availability[object.id] ? ": no data available" : ""}`}
            onFocus={() => setFocusedObject(object.id)}
            onKeyDown={(event) => handleKeyDown(event, object.id)}
            onClick={() => activateObject(object.id)}
          >
            {object.name}
          </button>
        ))}
      </div>

      {loading ? <div className={styles.notice}>{LOADING_MESSAGES.captains}</div> : null}
      {error && hasArchiveData ? <div className={styles.notice}>{error}</div> : null}
      {!loading && !showRunCard ? <div className={styles.touchHint}>{tips[tipIndex % tips.length]}</div> : null}
    </main>
  );
}
