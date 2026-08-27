import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import styles from "./SceneNavigator.module.css";

const MotionDiv = motion.div;

function isTypingTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }

  return target.closest("[contenteditable='true']") !== null;
}

function SceneNavigator({ scene, sceneItems, onSceneChange, uploadedCount }) {
  const [isOpen, setOpen] = useState(false);

  const activeIndex = useMemo(
    () => sceneItems.findIndex((item) => item.id === scene),
    [scene, sceneItems],
  );
  const activeItem = sceneItems[Math.max(activeIndex, 0)] ?? sceneItems[0];
  const routeProgress =
    activeIndex >= 0 ? ((activeIndex + 1) / sceneItems.length) * 100 : 0;

  useEffect(() => {
    const onKeyDown = (event) => {
      if (isTypingTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "m") {
        event.preventDefault();
        setOpen((previous) => !previous);
        return;
      }

      const numericIndex = Number.parseInt(event.key, 10);
      if (Number.isNaN(numericIndex)) {
        return;
      }

      const nextItem = sceneItems[numericIndex - 1];
      if (!nextItem) {
        return;
      }

      event.preventDefault();
      onSceneChange(nextItem.id);
      setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onSceneChange, sceneItems]);

  const jumpToScene = (nextScene) => {
    onSceneChange(nextScene);
    setOpen(false);
  };

  return (
    <div className={styles.navigatorRoot}>
      <button
        type="button"
        className={styles.toggleButton}
        aria-expanded={isOpen}
        aria-label="Toggle scene navigator"
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className={styles.compassBadge} aria-hidden="true">
          <svg className={styles.navIcon} viewBox="0 0 32 32" fill="none">
            {/* Ship's-wheel spokes, extending past the rim into the handles */}
            <g stroke="#e9bb6b" strokeWidth="1.5" strokeLinecap="round">
              <line x1="3" y1="16" x2="29" y2="16" />
              <line x1="16" y1="3" x2="16" y2="29" />
              <line x1="6.8" y1="6.8" x2="25.2" y2="25.2" />
              <line x1="25.2" y1="6.8" x2="6.8" y2="25.2" />
            </g>
            {/* Rim */}
            <circle
              cx="16"
              cy="16"
              r="8.4"
              fill="none"
              stroke="#e9bb6b"
              strokeWidth="1.6"
            />
            {/* Handle knobs */}
            <g fill="#f4cd84">
              <circle cx="29" cy="16" r="1.7" />
              <circle cx="16" cy="3" r="1.7" />
              <circle cx="3" cy="16" r="1.7" />
              <circle cx="16" cy="29" r="1.7" />
              <circle cx="25.2" cy="6.8" r="1.7" />
              <circle cx="6.8" cy="6.8" r="1.7" />
              <circle cx="25.2" cy="25.2" r="1.7" />
              <circle cx="6.8" cy="25.2" r="1.7" />
            </g>
            {/* Hub */}
            <circle cx="16" cy="16" r="3.4" fill="#f4cd84" />
            <circle cx="16" cy="16" r="1.4" fill="#6e4a1e" />
          </svg>
        </span>
        <span className={styles.activeScene}>
          {activeItem?.label ?? "Scene"}
        </span>
      </button>

      <AnimatePresence>
        {isOpen ? (
          <MotionDiv
            className={styles.menuPanel}
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <div className={styles.panelHeader}>
              <div className={styles.progressWrap}>
                <span className={styles.progressLabel}>
                  {Math.max(activeIndex + 1, 1)}/{sceneItems.length}
                </span>
                <div className={styles.progressTrack}>
                  <div
                    className={styles.progressFill}
                    style={{ width: `${routeProgress}%` }}
                  />
                </div>
              </div>
            </div>

            <div className={styles.sceneList}>
              {sceneItems.map((item, index) => {
                const isActive = item.id === scene;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`${styles.sceneButton} ${isActive ? styles.sceneButtonActive : ""}`}
                    onClick={() => jumpToScene(item.id)}
                    disabled={isActive}
                  >
                    <span className={styles.sceneIndex}>{index + 1}</span>
                    <span className={styles.sceneMeta}>
                      <span className={styles.sceneLabel}>{item.label}</span>
                      <span className={styles.sceneHint}>{item.hint}</span>
                    </span>
                    <span className={styles.sceneState}>
                      {isActive ? "Current" : "Jump"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className={styles.panelFooter}>
              <span className={styles.footerPill}>{uploadedCount} images</span>
              <span className={styles.footerPill}>Keys M · 1–{sceneItems.length}</span>
            </div>
          </MotionDiv>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default SceneNavigator;
