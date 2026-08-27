import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import styles from "./DatabaseSelector.module.css";
import {
  createDatabase,
  deleteDatabase,
  listDatabases,
} from "../../api/databaseApi";

const MotionDiv = motion.div;

function clampProgress(value) {
  const progress = Number(value);
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, progress));
}

export default function DatabaseSelector({
  onDatabaseSelected,
  onClose,
  isOpen,
  currentDatabase = "default",
  modeLabel = "Choose where to browse or store images",
  confirmLabel = "Use Database",
  processingFeatures = [],
}) {
  const [databases, setDatabases] = useState([]);
  const [selectedDb, setSelectedDb] = useState(currentDatabase || "default");
  const [newDbName, setNewDbName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [deletingDb, setDeletingDb] = useState("");
  const [error, setError] = useState("");
  const [mongoMessage, setMongoMessage] = useState("");
  const [mode, setMode] = useState("select"); // 'select' or 'create'

  const loadDatabases = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await listDatabases();
      const nextDatabases = result.databases;
      setDatabases(nextDatabases);
      setSelectedDb((current) =>
        nextDatabases.some((db) => db.name === current)
          ? current
          : (currentDatabase || nextDatabases[0]?.name || "default"),
      );
      setMongoMessage(result.mongoAvailable ? "" : result.message);
      setError("");
    } catch (e) {
      setDatabases([]);
      setMongoMessage("");
      setError(e.message || "Failed to load databases");
    } finally {
      setIsLoading(false);
    }
  }, [currentDatabase]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      loadDatabases();
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [isOpen, loadDatabases]);

  const handleCreateDatabase = async () => {
    if (!newDbName.trim()) {
      setError("Database name is required");
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(newDbName)) {
      setError(
        "Database name must contain only alphanumeric, hyphens, and underscores",
      );
      return;
    }

    setIsCreating(true);
    setError("");

    try {
      await createDatabase(newDbName, `Created via upload UI`);
      setNewDbName("");
      await loadDatabases();
      setSelectedDb(newDbName);
      setMode("select");
    } catch (e) {
      setError(e.message || "Failed to create database");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSelect = () => {
    const selected = databases.find((db) => db.name === selectedDb);
    onDatabaseSelected(selectedDb, selected);
  };

  const handleDelete = async (dbName) => {
    if (dbName === "default") {
      return;
    }
    const confirmed = window.confirm(
      `Remove dataset "${dbName}" and all of its images?`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingDb(dbName);
    setError("");
    try {
      await deleteDatabase(dbName);
      await loadDatabases();
    } catch (e) {
      setError(e.message || "Failed to remove dataset");
    } finally {
      setDeletingDb("");
    }
  };

  return (
    <AnimatePresence>
      {isOpen ? (
        <MotionDiv
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <MotionDiv
            className={styles.modal}
            initial={{ scale: 0.8, opacity: 0, y: -20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0, y: -20 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.header}>
              <h2>Select Database</h2>
              <p className={styles.subtitle}>
                {modeLabel}
              </p>
            </div>

            <div className={styles.content}>
              {mode === "select" ? (
                <>
                  {isLoading ? (
                    <div className={styles.loading}>
                      <div className={styles.spinner} />
                      Loading databases...
                    </div>
                  ) : (
                    <>
                      <div className={styles.databaseList}>
                        {mongoMessage ? (
                          <div className={styles.emptyState}>
                            {mongoMessage}
                          </div>
                        ) : null}
                        {!mongoMessage && databases.length === 0 ? (
                          <div className={styles.emptyState}>
                            No datasets found. Upload a ZIP to create one.
                          </div>
                        ) : null}
                        {databases.map((db) => (
                          <div key={db.name} className={styles.dbOption}>
                            <input
                              type="radio"
                              name="database"
                              value={db.name}
                              checked={selectedDb === db.name}
                              onChange={(e) => setSelectedDb(e.target.value)}
                            />
                            <span className={styles.dbLabel}>
                              <span className={styles.dbName}>{db.name}</span>
                              <span className={styles.dbCount}>
                                {db.image_count} images
                              </span>
                              {db.description && (
                                <span className={styles.dbDesc}>
                                  {db.description}
                                </span>
                              )}
                            </span>
                            {db.name !== "default" ? (
                              <button
                                type="button"
                                className={styles.deleteButton}
                                onClick={() => handleDelete(db.name)}
                                disabled={deletingDb === db.name}
                              >
                                {deletingDb === db.name ? "Removing" : "Remove"}
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>

                      {error && <div className={styles.error}>{error}</div>}

                      <div className={styles.actions}>
                        <button
                          className={styles.secondaryButton}
                          onClick={() => setMode("create")}
                        >
                          New Database
                        </button>
                        <button
                          className={styles.primaryButton}
                          onClick={handleSelect}
                          disabled={databases.length === 0 || Boolean(mongoMessage)}
                        >
                          {confirmLabel}
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className={styles.createForm}>
                    <label className={styles.formGroup}>
                      <span className={styles.label}>Database Name</span>
                      <input
                        type="text"
                        placeholder="e.g., my-collection-2024"
                        value={newDbName}
                        onChange={(e) => setNewDbName(e.target.value)}
                        disabled={isCreating}
                        className={styles.input}
                        autoFocus
                      />
                      <span className={styles.hint}>
                        Alphanumeric, hyphens, and underscores only
                      </span>
                    </label>

                    {error && <div className={styles.error}>{error}</div>}

                    <div className={styles.actions}>
                      <button
                        className={styles.secondaryButton}
                        onClick={() => {
                          setMode("select");
                          setNewDbName("");
                          setError("");
                        }}
                        disabled={isCreating}
                      >
                        Back
                      </button>
                      <button
                        className={styles.primaryButton}
                        onClick={handleCreateDatabase}
                        disabled={isCreating || !newDbName.trim()}
                      >
                        {isCreating ? "Creating..." : "Create"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </MotionDiv>

          {processingFeatures.length > 0 ? (
            <MotionDiv
              className={styles.processingDock}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.processingHeader}>
                <span>Processing Features</span>
                <strong>
                  {Math.round(
                    processingFeatures.reduce(
                      (sum, feature) => sum + clampProgress(feature.progress),
                      0,
                    ) / processingFeatures.length,
                  )}
                  %
                </strong>
              </div>
              <div className={styles.processingList}>
                {processingFeatures.map((feature) => (
                  <div
                    key={feature.pipelineName || feature.name}
                    className={styles.processingItem}
                  >
                    <div className={styles.processingMeta}>
                      <span>{feature.name}</span>
                      <strong>
                        {feature.status === "completed"
                          ? "Ready"
                          : feature.status === "failed"
                            ? "Failed"
                            : `${Math.round(clampProgress(feature.progress))}%`}
                      </strong>
                    </div>
                    <div className={styles.processingTrack}>
                      <span
                        className={styles.processingFill}
                        style={{ width: `${clampProgress(feature.progress)}%` }}
                      />
                    </div>
                    {feature.message ? (
                      <p className={styles.processingMessage}>
                        {feature.message}
                      </p>
                    ) : null}
                    {feature.error ? (
                      <p className={styles.processingError}>{feature.error}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </MotionDiv>
          ) : null}
        </MotionDiv>
      ) : null}
    </AnimatePresence>
  );
}
