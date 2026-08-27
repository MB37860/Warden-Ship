import JSZip from "jszip";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Chest from "../shared/Chest";
import StatusText from "../shared/StatusText";
import PipelineSelector from "../shared/PipelineSelector";
import DatabaseSelector from "../shared/DatabaseSelector";
import LoadingProgress from "../shared/LoadingProgress";
import useChestState from "../../hooks/useChestState";
import useParallax from "../../hooks/useParallax";
import {
  listImages,
  uploadImageBatch,
  setCurrentDatabase,
} from "../../api/imageApi";
import { getPipelineStatus } from "../../api/pipelineApi";
import {
  cleanArtworkFilename,
  getArtworkArtistName,
  needsLogbookClassification,
} from "../../utils/artworkNames";
import styles from "./Room.module.css";

const MotionDiv = motion.div;

const SUPPORTED_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
const MAX_IMAGES = 1000;
const PIPELINE_LABELS = {
  f1: "F1 - CLIP Embeddings",
  f2: "F2 - Logbook Classification",
  f5: "F5 - Navigator's Chart Table",
  f6: "F6 - Attribute Filters",
};
const SELECTED_DATABASE_STORAGE_KEY = "warden-ship:selected-database";
const CINEMATIC_ARCHIVE_DURATION = 12000;
const CINEMATIC_ZIP_FLIGHT_DELAY = 5000;
const CINEMATIC_ZIP_FLIGHT_DURATION = 4;

function clampProgress(value) {
  const progress = Number(value);
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, progress));
}

function parseArtworkYear(text = "") {
  const matches = String(text).match(/(?:^|[^0-9])([12][0-9]{3}|9[0-9]{2}|8[0-9]{2})(?![0-9])/g);
  if (!matches) return null;
  const years = matches
    .map((match) => Number(match.match(/([12][0-9]{3}|9[0-9]{2}|8[0-9]{2})/)?.[1]))
    .filter((year) => Number.isFinite(year) && year >= 800 && year <= 2026);
  return years.length ? Math.min(...years) : null;
}

function getStoredDatabase() {
  if (typeof window === "undefined") {
    return "default";
  }

  try {
    return (
      window.localStorage.getItem(SELECTED_DATABASE_STORAGE_KEY) || "default"
    );
  } catch {
    return "default";
  }
}

function setStoredDatabase(dbName) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SELECTED_DATABASE_STORAGE_KEY, dbName);
  } catch {
    // Ignore storage failures and keep the in-memory selection working.
  }
}

async function extractImagesFromZip(file) {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files)
    .filter(
      (entry) => !entry.dir && SUPPORTED_IMAGE_EXTENSIONS.test(entry.name),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_IMAGES);

  const urls = [];
  const images = [];
  const files = [];

  for (const [index, entry] of entries.entries()) {
    const blob = await entry.async("blob");
    const url = URL.createObjectURL(blob);
    const imageName = entry.name.split("/").pop() || `image-${index + 1}`;
    urls.push(url);
    files.push(
      new File([blob], imageName, { type: blob.type || "image/jpeg" }),
    );
    images.push({
      id: `${entry.name}-${index}`,
      src: url,
      name: imageName,
    });
  }

  return { images, urls, files };
}

function Room({
  appState,
  setAppState,
  fileName,
  setFileName,
  onFireCannons,
  onImagesReady,
  selectedDatabase: selectedDatabaseProp,
  onDatabaseChanged,
  cinematicCue = null,
  isFiringCannons,
}) {
  const p = useParallax();
  const { phase, triggerOpen, openChest } = useChestState(setAppState);
  const chestRef = useRef(null);
  const inputRef = useRef(null);
  const objectUrlsRef = useRef([]);
  const [hasZipFile, setHasZipFile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [screenPulseKey, setScreenPulseKey] = useState(0);
  const [zipFlight, setZipFlight] = useState(null);
  const [showPipelineSelector, setShowPipelineSelector] = useState(false);
  const [showDatabaseSelector, setShowDatabaseSelector] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedDatabase, setSelectedDatabase] = useState(() =>
    selectedDatabaseProp || getStoredDatabase(),
  );
  const [hasPendingUpload, setHasPendingUpload] = useState(false);
  const [isLoadingDatabase, setIsLoadingDatabase] = useState(false);
  const [databaseError, setDatabaseError] = useState("");
  const [featuresProgress, setFeaturesProgress] = useState([]);
  const [activePipelines, setActivePipelines] = useState([]);
  const [cinematicProgress, setCinematicProgress] = useState(0);
  const uploadedFilesRef = useRef(null);
  const metadataRef = useRef(null);
  const processingHideTimerRef = useRef(null);
  const cinematicArchiveRunRef = useRef(false);

  const clearObjectUrls = useCallback(() => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
  }, []);

  const clearProcessingTimer = useCallback(() => {
    if (processingHideTimerRef.current) {
      clearTimeout(processingHideTimerRef.current);
      processingHideTimerRef.current = null;
    }
  }, []);

  // Restore pipeline state on mount so failed pipelines show retry button after refresh
  useEffect(() => {
    let mounted = true;
    const allPipelines = Object.keys(PIPELINE_LABELS);
    getPipelineStatus(allPipelines).then((status) => {
      if (!mounted) return;
      const active = allPipelines.filter((name) => {
        const s = status[name]?.status;
        return s === "running" || s === "failed";
      });
      if (active.length === 0) return;
      setActivePipelines(active);
      setFeaturesProgress(
        active.map((name) => {
          const s = status[name] || {};
          const backendStatus = s.status || "idle";
          const normalizedStatus = backendStatus === "running" ? "processing" : backendStatus;
          return {
            name: PIPELINE_LABELS[name] || name.toUpperCase(),
            pipelineName: name,
            status: normalizedStatus === "idle" ? "pending" : normalizedStatus,
            progress: Number(s.progress ?? 0),
            message: s.message || "",
            stage: s.stage || normalizedStatus,
            canUse: Boolean(s.can_use),
            error: s.error || null,
          };
        }),
      );
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  const launchZipFlight = useCallback((startPoint) => {
    const rect = chestRef.current?.getBoundingClientRect();
    if (!rect || !startPoint) {
      return;
    }

    setZipFlight({
      id: Date.now(),
      startX: startPoint.x,
      startY: startPoint.y,
      endX: rect.left + rect.width / 2,
      endY: rect.top + rect.height / 2,
    });
  }, []);

  useEffect(() => {
    if (appState !== phase) {
      setAppState(phase);
    }
  }, [appState, phase, setAppState]);

  useEffect(() => {
    setCurrentDatabase(selectedDatabase);
  }, [selectedDatabase]);

  useEffect(() => {
    if (selectedDatabaseProp && selectedDatabaseProp !== selectedDatabase) {
      const timerId = window.setTimeout(() => {
        setSelectedDatabase(selectedDatabaseProp);
      }, 0);
      return () => {
        window.clearTimeout(timerId);
      };
    }
    return undefined;
  }, [selectedDatabase, selectedDatabaseProp]);

  useEffect(() => {
    if (cinematicCue !== "archive-load") {
      if (!cinematicCue) {
        cinematicArchiveRunRef.current = false;
        const resetId = window.setTimeout(() => {
          setCinematicProgress(0);
        }, 0);
        return () => {
          window.clearTimeout(resetId);
        };
      }
      return undefined;
    }

    if (cinematicArchiveRunRef.current) {
      return undefined;
    }

    cinematicArchiveRunRef.current = true;
    let intervalId = null;
    let flightId = null;
    const setupId = window.setTimeout(() => {
      const startedAt = Date.now();
      setCinematicProgress(2);
      setMenuOpen(false);
      setFileName(`${selectedDatabase} archive`);
      flightId = window.setTimeout(() => {
        setHasZipFile(true);
        setScreenPulseKey((value) => value + 1);
        launchZipFlight({
          x: window.innerWidth * 0.5,
          y: Math.max(window.innerHeight * 0.2, 120),
        });
        triggerOpen({ name: "cinematic-archive.zip" });
      }, CINEMATIC_ZIP_FLIGHT_DELAY);

      intervalId = window.setInterval(() => {
        const elapsed = Date.now() - startedAt;
        setCinematicProgress(
          Math.min(100, 2 + (elapsed / CINEMATIC_ARCHIVE_DURATION) * 98),
        );
      }, 140);
    }, 0);

    return () => {
      window.clearTimeout(setupId);
      if (flightId !== null) {
        window.clearTimeout(flightId);
      }
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [
    cinematicCue,
    launchZipFlight,
    selectedDatabase,
    setFileName,
    triggerOpen,
  ]);

  useEffect(
    () => () => {
      clearObjectUrls();
    },
    [clearObjectUrls],
  );

  // Async  upload handler that doesn't block UI
  const uploadAsync = useCallback(
    async (files, metadata, dbName) => {
      setCurrentDatabase(dbName);
      setMenuOpen(false);
      setIsUploading(true);
      setUploadProgress(0);
      setDatabaseError("");

      try {
        const persistedImages = await uploadImageBatch(
          files,
          metadata,
          dbName,
          (storedCount, totalCount) => {
            setUploadProgress(
              Math.round(clampProgress((storedCount / totalCount) * 100)),
            );
          },
        );
        setUploadProgress(100);

        // Wait a bit before closing dialog
        setTimeout(() => {
          setIsUploading(false);
          setUploadProgress(0);
          onImagesReady?.(persistedImages);
          setHasZipFile(true);
          setShowPipelineSelector(true);
        }, 800);
      } catch (error) {
        console.error("Upload error:", error);
        setIsUploading(false);
        setDatabaseError(
          `Upload failed: ${error.message || "images were not stored"}`,
        );
        const fallbackImages = uploadedFilesRef.current.map((file, index) => ({
          id: `fallback-${index}`,
          filename: file.name,
          imageUrl: URL.createObjectURL(file),
          metadata: {},
          tags: [],
          similarity: null,
        }));
        onImagesReady?.(fallbackImages);
        setHasZipFile(true);
        setShowPipelineSelector(true);
      }
    },
    [onImagesReady],
  );

  const processFile = useCallback(
    async (file, dropPoint) => {
      if (!file) {
        return;
      }

      if (!file.name.toLowerCase().endsWith(".zip")) {
        return;
      }

      setFileName(file.name);
      clearObjectUrls();

      try {
        const { images, urls, files } = await extractImagesFromZip(file);
        objectUrlsRef.current = urls;
        uploadedFilesRef.current = files;
        setHasPendingUpload(true);

        const metadataByName = {};
        images.forEach((image) => {
          const parsedYear = parseArtworkYear(image.name);
          const artist = needsLogbookClassification(image)
            ? ""
            : getArtworkArtistName(image, "");
          const cleanName = cleanArtworkFilename(image.name);
          metadataByName[image.name] = {
            ...(artist ? { artist } : {}),
            caption: cleanName || image.name.replace(/[-_]/g, " "),
            ...(parsedYear ? { year: parsedYear, year_source: "filename" } : {}),
            source_scene: "chest-room",
            tags: ["zip-upload", "star-map", "history-map"],
          };
        });
        metadataRef.current = metadataByName;

        // Show database selector first
        setMenuOpen(false);
        setShowDatabaseSelector(true);
        launchZipFlight(dropPoint);
        setScreenPulseKey((value) => value + 1);
        triggerOpen(file);
      } catch (error) {
        console.error("Zip extraction error:", error);
        onImagesReady?.([]);
        setHasZipFile(false);
        setHasPendingUpload(false);
      }
    },
    [clearObjectUrls, launchZipFlight, onImagesReady, setFileName, triggerOpen],
  );

  const handleDatabaseSelected = useCallback(
    async (dbName) => {
      setSelectedDatabase(dbName);
      onDatabaseChanged?.(dbName);
      setShowDatabaseSelector(false);
      setCurrentDatabase(dbName);
      setStoredDatabase(dbName);

      if (uploadedFilesRef.current && metadataRef.current) {
        setHasPendingUpload(false);
        uploadAsync(uploadedFilesRef.current, metadataRef.current, dbName);
        return;
      }

      setIsLoadingDatabase(true);
      setDatabaseError("");
      try {
        let existingImages = [];
        existingImages = await listImages(MAX_IMAGES, dbName);
        onImagesReady?.(existingImages);
        setHasZipFile(existingImages.length > 0);
        setFileName(`${dbName} database`);
        setScreenPulseKey((value) => value + 1);
      } catch (error) {
        setDatabaseError(error.message || "Failed to load database");
      } finally {
        setIsLoadingDatabase(false);
      }
    },
    [onDatabaseChanged, onImagesReady, setFileName, uploadAsync],
  );

  const handleOpenDatabaseSelector = useCallback(() => {
    uploadedFilesRef.current = null;
    metadataRef.current = null;
    setHasPendingUpload(false);
    setDatabaseError("");
    setMenuOpen(false);
    setShowDatabaseSelector(true);
  }, []);

  const handlePipelinesStarted = useCallback(
    (pipelines) => {
      const selected = Array.isArray(pipelines) ? pipelines : [];
      clearProcessingTimer();
      setActivePipelines(selected);
      setFeaturesProgress(
        selected.map((name) => ({
          name: PIPELINE_LABELS[name] || name.toUpperCase(),
          pipelineName: name,
          status: "processing",
          progress: 0,
          message: "Queued for analysis",
        })),
      );
    },
    [clearProcessingTimer],
  );

  useEffect(() => {
    const onDragOver = (event) => {
      event.preventDefault();
      setIsDragging(true);
    };

    const onDragLeave = (event) => {
      if (event.relatedTarget === null) {
        setIsDragging(false);
      }
    };

    const onDrop = (event) => {
      event.preventDefault();
      setIsDragging(false);
      processFile(event.dataTransfer?.files?.[0], {
        x: event.clientX,
        y: event.clientY,
      });
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);

    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [processFile]);

  useEffect(() => {
    if (activePipelines.length === 0) {
      return undefined;
    }

    let mounted = true;
    let intervalId = null;

    const syncPipelineStatus = async () => {
      try {
        const status = await getPipelineStatus(activePipelines);
        if (!mounted) {
          return;
        }

        const mapped = activePipelines.map((pipelineName) => {
          const pipelineState = status[pipelineName] || {};
          const backendStatus = pipelineState.status || "idle";
          const normalizedStatus =
            backendStatus === "running" ? "processing" : backendStatus;
          const progressValue = Number(
            pipelineState.progress ??
              (normalizedStatus === "completed" ? 100 : 0),
          );

          return {
            name: PIPELINE_LABELS[pipelineName] || pipelineName.toUpperCase(),
            pipelineName,
            status: normalizedStatus === "idle" ? "pending" : normalizedStatus,
            progress: clampProgress(progressValue),
            message: pipelineState.message || "",
            stage: pipelineState.stage || normalizedStatus,
            canUse: Boolean(pipelineState.can_use),
            error: pipelineState.error || null,
          };
        });

        setFeaturesProgress(mapped);

        const stillRunning = mapped.some((item) => {
          return (
            item.status === "processing" ||
            item.status === "running" ||
            item.status === "pending"
          );
        });
        const hasFailed = mapped.some((item) => item.status === "failed");

        if (!stillRunning && !hasFailed) {
          clearProcessingTimer();
          processingHideTimerRef.current = window.setTimeout(() => {
            setActivePipelines([]);
            setFeaturesProgress([]);
            processingHideTimerRef.current = null;
          }, 1200);
        }
      } catch {
        if (!mounted) {
          return;
        }
      }
    };

    syncPipelineStatus();
    intervalId = window.setInterval(syncPipelineStatus, 1500);

    return () => {
      mounted = false;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [activePipelines, clearProcessingTimer]);

  const handleChooseFile = () => {
    setMenuOpen(false);
    inputRef.current?.click();
  };

  const handleInputChange = (event) => {
    const file = event.target.files?.[0];
    processFile(file, {
      x: window.innerWidth * 0.5,
      y: window.innerHeight * 0.8,
    });
  };

  const handleChestClick = () => {
    openChest();
    setMenuOpen((value) => !value);
  };

  const isCinematicArchive = cinematicCue === "archive-load";
  const isCinematicBroadside = cinematicCue === "broadside-turn";
  const isCinematicRoom = isCinematicArchive || isCinematicBroadside;

  return (
    <div
      className={`${styles.roomRoot} ${isCinematicRoom ? styles.cinematicMode : ""}`}
    >
      <div id="scene" className={styles.scene}>
        {!isFiringCannons && (
          <Chest
            phase={phase}
            parallax={p}
            menuOpen={menuOpen}
            onChestClick={handleChestClick}
            onFireCannons={onFireCannons}
            hasZip={hasZipFile}
            onChooseFile={handleChooseFile}
            onChooseDataset={handleOpenDatabaseSelector}
            cinematicView={isCinematicBroadside ? "cannons" : isCinematicRoom ? "chest" : null}
          cinematicMode={isCinematicRoom}
        />
        )}
        <div className={styles.chestAnchor} ref={chestRef} />

        <AnimatePresence>
          {zipFlight ? (
            <MotionDiv
              key={zipFlight.id}
              className={styles.zipToken}
              style={{ left: zipFlight.startX, top: zipFlight.startY }}
              initial={{ x: 0, y: 0, scale: 0.95, opacity: 0 }}
              animate={{
                x: zipFlight.endX - zipFlight.startX,
                y: zipFlight.endY - zipFlight.startY,
                scale: [0.95, 1, 0.24],
                rotate: [-8, 8, 0],
                opacity: [0, 1, 1, 0],
              }}
              transition={{
                duration: CINEMATIC_ZIP_FLIGHT_DURATION,
                ease: [0.22, 0.61, 0.36, 1],
              }}
              onAnimationComplete={() => setZipFlight(null)}
            >
              ZIP
            </MotionDiv>
          ) : null}
        </AnimatePresence>
      </div>
      <div className={styles.atmosphere} />
      <div className={styles.roomVignette} />
      <AnimatePresence>
        {screenPulseKey > 0 ? (
          <MotionDiv
            key={screenPulseKey}
            className={styles.screenPulse}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.22, 0] }}
            transition={{ duration: 0.55, ease: "easeOut" }}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isDragging ? (
          <MotionDiv
            className={styles.dragHint}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            DROP ZIP TO LOAD
          </MotionDiv>
        ) : null}
      </AnimatePresence>

      {isCinematicRoom ? (
        <div className={styles.cinematicArchivePanel}>
          <span className={styles.databaseEyebrow}>
            {isCinematicArchive ? "Archive Transfer" : "Broadside Control"}
          </span>
          <strong className={styles.databaseName}>
            {isCinematicArchive ? selectedDatabase : "Cannons Armed"}
          </strong>
          <p className={styles.cinematicArchiveText}>
            {isCinematicArchive
              ? "Staging the selected collection for visual discovery"
              : "Collection secured. Turning right to launch the voyage."}
          </p>
          {isCinematicArchive ? (
            <>
              <div className={styles.cinematicProgressTrack}>
                <div
                  className={styles.cinematicProgressFill}
                  style={{ width: `${cinematicProgress}%` }}
                />
              </div>
              <span className={styles.cinematicPercent}>
                Uploading collection {Math.round(cinematicProgress)}%
              </span>
            </>
          ) : null}
        </div>
      ) : (
        <>
          <div className={styles.sceneControls}>
            <div className={styles.databasePanel}>
              <span className={styles.databaseEyebrow}>Current Database</span>
              <strong className={styles.databaseName}>{selectedDatabase}</strong>
              <span className={styles.databaseStatus}>
                {isLoadingDatabase
                  ? "Loading dataset..."
                  : hasZipFile
                    ? "Images ready"
                    : "Choose an existing dataset or upload ZIP"}
              </span>
              {databaseError ? (
                <span className={styles.databaseError}>{databaseError}</span>
              ) : null}
            </div>
          </div>

          <StatusText phase={phase} fileName={fileName} />
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        style={{ display: "none" }}
        onChange={handleInputChange}
      />

      <DatabaseSelector
        isOpen={showDatabaseSelector}
        onDatabaseSelected={handleDatabaseSelected}
        onClose={() => setShowDatabaseSelector(false)}
        currentDatabase={selectedDatabase}
        processingFeatures={featuresProgress}
        modeLabel={
          hasPendingUpload
            ? "Choose where to store this ZIP upload"
            : "Choose an existing MongoDB dataset"
        }
        confirmLabel={hasPendingUpload ? "Upload Here" : "Use Dataset"}
      />

      <LoadingProgress
        isVisible={isUploading}
        progress={uploadProgress}
        fileName={fileName}
      />

      <AnimatePresence>
        {showPipelineSelector ? (
          <PipelineSelector
            fileName={fileName}
            dbName={selectedDatabase}
            onStarted={handlePipelinesStarted}
            onClose={() => setShowPipelineSelector(false)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default Room;
