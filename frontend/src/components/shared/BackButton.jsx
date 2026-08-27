import styles from "./BackButton.module.css";
import { LABELS } from "../../lib/uiCopy";

// One back/return control for the whole app. Replaces the per-scene emoji
// buttons (🗺, ←) with a single styled control + a crisp inline SVG chevron,
// so every screen's "go back" affordance looks and behaves the same.
export default function BackButton({
  onClick,
  label = LABELS.back,
  className = "",
  variant = "solid",
  ...rest
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.button} ${styles[variant] || ""} ${className}`}
      {...rest}
    >
      <svg
        className={styles.icon}
        viewBox="0 0 24 24"
        width="16"
        height="16"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M14.5 5 8 12l6.5 7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>{label}</span>
    </button>
  );
}
