import styles from "../CaptainsQuarters.module.css";

export default function NavigatorsGuide({ open, onToggle }) {
  return (
    <>
      <button type="button" className={styles.guideToggle} onClick={onToggle} aria-expanded={open} aria-label="Toggle Navigator's Guide">
        ✒
      </button>
      <aside className={`${styles.guidePanel} ${open ? styles.guidePanelOpen : ""}`} aria-hidden={!open}>
        <h2>Navigator&apos;s Guide</h2>
        <p>Turn the Dyer&apos;s Wheel to filter by colour.</p>
        <p>Pose the lay figure to seek kindred bodies.</p>
        <p>Turn the globe to choose an origin.</p>
        <p>Open the hold drawer to view the matching paintings.</p>
      </aside>
    </>
  );
}
