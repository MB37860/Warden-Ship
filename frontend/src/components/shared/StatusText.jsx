import styles from "./StatusText.module.css";

const STATUS_MAP = {
  idle: {
    text: "Drop a ZIP or click chest",
    color: "rgba(160,140,100,0.45)",
    textShadow: "none",
  },
  opening: {
    text: "Archive entering vault...",
    color: "rgba(180,140,40,0.7)",
    textShadow: "none",
  },
  opened: {
    text: "Vault open - choose a ZIP to begin",
    color: "rgba(199,165,109,0.88)",
    textShadow: "0 0 14px rgba(162,119,45,0.3)",
  },
  belts: {
    text: "Loading cargo...",
    color: "rgba(180,140,40,0.85)",
    textShadow: "none",
  },
  ready: {
    text: "Cargo loaded — click chest for features",
    color: "rgba(220,180,60,1)",
    textShadow: "0 0 20px rgba(200,150,20,0.4)",
  },
};

function StatusText({ phase }) {
  const config = STATUS_MAP[phase] ?? STATUS_MAP.idle;

  return (
    <div className={styles.statusWrap}>
      <p
        key={phase}
        className={styles.statusText}
        style={{ color: config.color, textShadow: config.textShadow }}
      >
        {config.text}
      </p>
    </div>
  );
}

export default StatusText;
