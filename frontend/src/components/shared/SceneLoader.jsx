import styles from "./SceneLoader.module.css";
import { LOADING_MESSAGES } from "../../lib/uiCopy";

// The one full-screen loading screen for the whole app. Every scene-level
// "loading…" gate routes through this so the look + motion are identical
// everywhere. Pass `message` directly, or `messageKey` to pull from uiCopy.
export default function SceneLoader({
  message,
  messageKey = "scene",
  variant = "full",
}) {
  const text = message ?? LOADING_MESSAGES[messageKey] ?? LOADING_MESSAGES.scene;

  return (
    <div
      className={`${styles.root} ${variant === "overlay" ? styles.overlay : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className={styles.spinner} aria-hidden="true" />
      <p className={styles.message}>{text}</p>
    </div>
  );
}
