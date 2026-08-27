import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import styles from "./PipelineProgressBar.module.css";

const MotionDiv = motion.div;

// Anything still moving, plus failures — a failed pipeline has to stay on the
// bar or its Retry button is unreachable.
const OPEN_STATUSES = new Set(["running", "processing", "pending", "failed"]);

function clampProgress(value) {
  const progress = Number(value);
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, progress));
}

function statusClass(status) {
  if (status === "running") return "processing";
  if (status === "idle") return "pending";
  return status;
}

function statusLabel(status, progress) {
  if (status === "completed") return "Ready";
  if (status === "failed") return "Failed";
  if (status === "running" || status === "processing") {
    return `${Math.round(progress)}%`;
  }
  return "Pending";
}

export default function PipelineProgressBar({ pipelines, onRetry }) {
  const visible = (pipelines || []).filter((pipeline) =>
    OPEN_STATUSES.has(pipeline.status),
  );
  const hasWork = visible.length > 0;
  const [isDismissed, setIsDismissed] = useState(false);
  const hadWorkRef = useRef(hasWork);

  // A new run re-opens the bar even if the previous one was dismissed.
  useEffect(() => {
    if (hasWork && !hadWorkRef.current) {
      setIsDismissed(false);
    }
    hadWorkRef.current = hasWork;
  }, [hasWork]);

  if (!hasWork) {
    return null;
  }

  const isShown = !isDismissed;

  return (
    <MotionDiv
      className={styles.bar}
      initial={{ y: -90, opacity: 0 }}
      animate={{ y: isShown ? 0 : -90, opacity: isShown ? 1 : 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 220 }}
      aria-live="polite"
      // Opacity-0 does not stop clicks: once hidden the bar must not capture
      // pointer events, or it silently blocks the top of the screen.
      style={{ pointerEvents: isShown ? "auto" : "none" }}
    >
      <div className={styles.intro}>
        <h3 className={styles.title}>Processing Features</h3>
        <p className={styles.subtitle}>
          You can keep exploring while these run.
        </p>
      </div>

      <div className={styles.items}>
        {visible.map((pipeline) => {
          const progress = clampProgress(pipeline.progress);
          const state = statusClass(pipeline.status);

          return (
            <div
              key={pipeline.pipelineName || pipeline.name}
              className={`${styles.chip} ${state === "failed" ? styles.chipFailed : ""}`}
            >
              <div className={styles.chipHeader}>
                <span className={styles.chipName}>{pipeline.name}</span>
                <span className={`${styles.chipStatus} ${styles[state] || ""}`}>
                  {statusLabel(pipeline.status, progress)}
                </span>
              </div>
              {state !== "failed" ? (
                <div className={styles.track}>
                  <MotionDiv
                    className={`${styles.fill} ${styles[state] || ""}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ type: "spring", damping: 25 }}
                  />
                </div>
              ) : null}
              {pipeline.message ? (
                <p className={styles.message}>{pipeline.message}</p>
              ) : null}
              {pipeline.error ? (
                <p className={styles.error}>{pipeline.error}</p>
              ) : null}
              {state === "failed" && onRetry ? (
                <button
                  type="button"
                  className={styles.retryBtn}
                  onClick={() => onRetry(pipeline.pipelineName)}
                >
                  Retry
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className={styles.closeBtn}
        onClick={() => setIsDismissed(true)}
        aria-label="Hide processing status"
        title="Hide — pipelines keep running"
      >
        ×
      </button>
    </MotionDiv>
  );
}
