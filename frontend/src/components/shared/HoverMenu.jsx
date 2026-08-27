import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./HoverMenu.module.css";

function HoverMenu({ hasZip, onChooseFile, onChooseDataset }) {
  const containerRef = useRef(
    typeof document !== "undefined" ? document.createElement("div") : null,
  );
  const [portalContainer, setPortalContainer] = useState(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    document.body.appendChild(container);
    setPortalContainer(container);

    return () => {
      setPortalContainer(null);
      container.remove();
    };
  }, []);

  const runPointerCommand = (event, command) => {
    event.preventDefault();
    event.stopPropagation();
    command?.();
  };

  const runKeyboardCommand = (event, command) => {
    event.stopPropagation();
    if (event.detail === 0) {
      command?.();
    }
  };

  const stopPointerPropagation = (event) => {
    event.stopPropagation();
  };

  const runClickCommand = (event, command) => {
    event.stopPropagation();
    command?.();
  };

  const content = (
    <div className={styles.menuRoot} role="dialog" aria-label="Vault Console">
      <div className={styles.menuCard}>
        <div className={styles.menuHeaderRow}>
          <p className={styles.menuEyebrow}>Vault Console</p>
          <span className={styles.statePill}>
            {hasZip ? "Archive connected" : "Awaiting archive"}
          </span>
        </div>

        <h3 className={styles.menuTitle}>Vault Datasets</h3>
        <p className={styles.menuSubtitle}>
          {hasZip
            ? "Choose another dataset or upload a new ZIP archive."
            : "Upload a new dataset or choose one already stored in MongoDB."}
        </p>

        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.primaryButton}
            onPointerDown={(event) => runPointerCommand(event, onChooseFile)}
            onClick={(event) => runKeyboardCommand(event, onChooseFile)}
          >
            Upload Dataset
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onPointerDown={stopPointerPropagation}
            onClick={(event) => runClickCommand(event, onChooseDataset)}
          >
            Choose Dataset
          </button>
        </div>
      </div>
    </div>
  );

  return portalContainer ? createPortal(content, portalContainer) : content;
}

export default HoverMenu;
