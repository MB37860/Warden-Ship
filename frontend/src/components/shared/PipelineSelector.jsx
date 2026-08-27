import { useState } from "react";
import { motion } from "framer-motion";
import styles from "./PipelineSelector.module.css";
import { runPipelines } from "../../api/pipelineApi";

const MotionDiv = motion.div;

export default function PipelineSelector({
  onClose,
  onStarted,
  fileName,
  dbName,
}) {
  const [selectedPipelines, setSelectedPipelines] = useState({
    f1: true,
    f2: true,
    f5: true,
    f6: true,
  });
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");

  const togglePipeline = (name) => {
    setSelectedPipelines((prev) => ({
      ...prev,
      [name]: !prev[name],
    }));
  };

  const handleStart = async () => {
    const selected = Object.keys(selectedPipelines).filter(
      (k) => selectedPipelines[k],
    );

    if (selected.length === 0) {
      setError("Please select at least one pipeline");
      return;
    }

    setIsRunning(true);
    setError("");

    try {
      await runPipelines(selected, dbName);
      onStarted?.(selected);
      // Close dialog after successfully starting pipelines
      setTimeout(() => {
        onClose();
      }, 800);
    } catch (e) {
      setError(e.message || "Failed to start pipelines");
      setIsRunning(false);
    }
  };

  const handleSkip = () => {
    onClose();
  };

  return (
    <MotionDiv
      className={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <MotionDiv
        className={styles.modal}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ type: "spring", damping: 20 }}
      >
        <div className={styles.header}>
          <h2>Feature Pipelines</h2>
          <p className={styles.subtitle}>
            {fileName && <span>Uploaded: {fileName}</span>}
          </p>
        </div>

        <div className={styles.content}>
          <p className={styles.intro}>
            Your images have been stored. Now choose which features to analyze
            in the background:
          </p>

          <div className={styles.options}>
            <label className={styles.option}>
              <input
                type="checkbox"
                checked={selectedPipelines.f1}
                onChange={() => togglePipeline("f1")}
                disabled={isRunning}
              />
              <div className={styles.optionContent}>
                <span className={styles.optionTitle}>F1 - CLIP Embeddings</span>
                <span className={styles.optionDesc}>
                  Background image vectorization used by semantic search and
                  star matching
                </span>
              </div>
            </label>

            <label className={styles.option}>
              <input
                type="checkbox"
                checked={selectedPipelines.f2}
                onChange={() => togglePipeline("f2")}
                disabled={isRunning}
              />
              <div className={styles.optionContent}>
                <span className={styles.optionTitle}>
                  F2 - Logbook Gallery Classification
                </span>
                <span className={styles.optionDesc}>
                  Genre, style, and artist readings used by the logbook gallery
                </span>
              </div>
            </label>

            <label className={styles.option}>
              <input
                type="checkbox"
                checked={selectedPipelines.f5}
                onChange={() => togglePipeline("f5")}
                disabled={isRunning}
              />
              <div className={styles.optionContent}>
                <span className={styles.optionTitle}>
                  F5 - Navigator's Chart Table
                </span>
                <span className={styles.optionDesc}>
                  Style islands, neighbor routes, eras, and table-map
                  coordinates
                </span>
              </div>
            </label>

            <label className={styles.option}>
              <input
                type="checkbox"
                checked={selectedPipelines.f6}
                onChange={() => togglePipeline("f6")}
                disabled={isRunning}
              />
              <div className={styles.optionContent}>
                <span className={styles.optionTitle}>
                  F6 - Attribute Filters
                </span>
                <span className={styles.optionDesc}>
                  4 visual analysis filters (poses, colors, hough,
                  portrait)
                </span>
              </div>
            </label>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          {isRunning && (
            <div className={styles.running}>
              <div className={styles.spinner} />
              <p>Starting pipelines in background...</p>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button
            className={styles.skipBtn}
            onClick={handleSkip}
            disabled={isRunning}
          >
            Skip for now
          </button>
          <button
            className={styles.startBtn}
            onClick={handleStart}
            disabled={
              isRunning ||
              !Object.values(selectedPipelines).some(Boolean)
            }
          >
            {isRunning ? "Starting..." : "Start Analysis"}
          </button>
        </div>
      </MotionDiv>
    </MotionDiv>
  );
}
