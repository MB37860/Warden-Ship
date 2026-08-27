import { useCallback, useEffect, useState } from "react";
import { getF6Index } from "../api/f6Api";
import { useF6Filters } from "./useF6Filters";

const EMPTY_F6_INDEX = [];

export default function useF6Data(databaseName = "default") {
  const [reloadKey, setReloadKey] = useState(0);
  const hasLoadedIndex = useF6Filters((state) => Object.prototype.hasOwnProperty.call(state.indexesByDatabase, databaseName));
  const rawIndex = useF6Filters((state) => state.indexesByDatabase[databaseName] || EMPTY_F6_INDEX);
  const loading = useF6Filters((state) => state.loadingByDatabase[databaseName] ?? !Object.prototype.hasOwnProperty.call(state.indexesByDatabase, databaseName));
  const error = useF6Filters((state) => state.errorByDatabase[databaseName] || "");
  const setIndexForDatabase = useF6Filters((state) => state.setIndexForDatabase);
  const setLoadingForDatabase = useF6Filters((state) => state.setLoadingForDatabase);
  const setErrorForDatabase = useF6Filters((state) => state.setErrorForDatabase);
  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (hasLoadedIndex && reloadKey === 0) {
      setLoadingForDatabase(databaseName, false);
      return () => {
        cancelled = true;
      };
    }

    setLoadingForDatabase(databaseName, true);
    setErrorForDatabase(databaseName, "");
    getF6Index(databaseName)
      .then((payload) => {
        const nextIndex = Array.isArray(payload?.index)
          ? payload.index
          : Array.isArray(payload)
            ? payload
            : [];
        if (!cancelled) setIndexForDatabase(databaseName, nextIndex);
      })
      .catch((loadError) => {
        if (!cancelled) {
          const message = loadError.message === "index.json not found"
            ? `No F6 attribute index yet for "${databaseName}". Run F6 to build this dataset's attribute filters.`
            : loadError.message || "F6 index is not available yet.";
          setErrorForDatabase(databaseName, message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingForDatabase(databaseName, false);
      });

    return () => {
      cancelled = true;
    };
  }, [databaseName, hasLoadedIndex, reloadKey, setErrorForDatabase, setIndexForDatabase, setLoadingForDatabase]);

  return { rawIndex, loading, error, reload };
}
