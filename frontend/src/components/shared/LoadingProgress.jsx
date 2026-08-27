import { motion } from "framer-motion";
import styles from "./LoadingProgress.module.css";

const MotionDiv = motion.div;

function clampProgress(value) {
  const progress = Number(value);
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, progress));
}

// Upload only. Pipeline progress lives in the app-level PipelineProgressBar,
// which follows the run across every scene instead of only this one.
export default function LoadingProgress({ isVisible, progress, fileName }) {
  const safeProgress = clampProgress(progress);

  return (
    <MotionDiv
      className={styles.container}
      initial={{ opacity: 0 }}
      animate={{ opacity: isVisible ? 1 : 0 }}
      transition={{ duration: 0.3 }}
      style={{ pointerEvents: isVisible ? "auto" : "none" }}
    >
      {/* Only while uploading: the backdrop is hit-testable, so rendering it
          when hidden would swallow every click in the scene behind it. */}
      {isVisible ? <div className={styles.backdrop} /> : null}

      <MotionDiv
        className={styles.content}
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", damping: 20 }}
        // Opacity-0 does not stop clicks: when hidden the card must not capture
        // pointer events, or it silently blocks the right side of the screen.
        style={{ pointerEvents: isVisible ? "auto" : "none" }}
      >
        <div className={styles.header}>
          <h3>Loading Images</h3>
          {fileName && <p className={styles.fileName}>{fileName}</p>}
        </div>

        <div className={styles.body}>
          <div className={styles.section}>
            <div className={styles.label}>
              <span>Upload Progress</span>
              <span className={styles.percent}>
                {Math.round(safeProgress)}%
              </span>
            </div>
            <div className={styles.progressBar}>
              <MotionDiv
                className={styles.progressFill}
                initial={{ width: 0 }}
                animate={{ width: `${safeProgress}%` }}
                transition={{ type: "spring", damping: 25 }}
              />
            </div>
          </div>
        </div>

        <div className={styles.note}>
          <p className={styles.noteText}>
            You can navigate around the app while images are loading.
          </p>
        </div>
      </MotionDiv>
    </MotionDiv>
  );
}
