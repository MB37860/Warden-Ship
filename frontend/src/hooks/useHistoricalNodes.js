import { useCallback, useEffect, useState } from "react";
import { getF5Coords } from "../api/f5Api";
import { getPipelineStatus, runPipelines } from "../api/pipelineApi";
import { normalizeHistoricalNodes } from "../utils/historicalAnalysis";

// Shared loader for the dated, map-placed nodes that both the Creativity
// Currents (F3) and Influence Routes (F4) scenes draw from. Lifted out of the
// old SVG HistoricalAnalysis screen so the two 3D cabins read the same F5
// artifact and offer the same "build it first" affordance.
export function useHistoricalNodes(databaseName) {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasArtifact, setHasArtifact] = useState(false);
  const [omittedCount, setOmittedCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    let mounted = true;
    Promise.resolve().then(() => {
      if (mounted) {
        setNodes([]);
        setLoading(true);
        setError("");
        setHasArtifact(false);
        setOmittedCount(0);
      }
    });
    getF5Coords(databaseName)
      .then((payload) => {
        if (!mounted) return;
        if (payload.ok === false) {
          setNodes([]);
          setError("Build the F5 historical map for this dataset to begin.");
          return;
        }
        const sourceCoords = Array.isArray(payload.coords) ? payload.coords : [];
        const plottedNodes = normalizeHistoricalNodes(sourceCoords);
        setHasArtifact(true);
        setNodes(plottedNodes);
        setOmittedCount(Math.max(0, sourceCoords.length - plottedNodes.length));
        if (!plottedNodes.length) {
          setError("This F5 map has no works with a usable historical date and position.");
        }
      })
      .catch(() => {
        if (mounted) {
          setNodes([]);
          setError("The F5 historical map could not be loaded for this dataset.");
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [databaseName, reloadKey]);

  return { nodes, loading, error, hasArtifact, omittedCount, reload };
}

export function useHistoricalBuild(databaseName, reload) {
  const [status, setStatus] = useState({ state: "idle", progress: 0, message: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    Promise.resolve().then(() => {
      if (mounted) {
        setStatus({ state: "idle", progress: 0, message: "" });
        setError("");
      }
    });
    return () => {
      mounted = false;
    };
  }, [databaseName]);

  const start = useCallback(async () => {
    setError("");
    setStatus({ state: "starting", progress: 0, message: "Starting F5 historical map..." });
    try {
      await runPipelines("f5", databaseName);
      setStatus({ state: "running", progress: 1, message: "Preparing historical map..." });
    } catch (startError) {
      setStatus({ state: "failed", progress: 0, message: "" });
      setError(startError.message || "Could not start F5 analysis.");
    }
  }, [databaseName]);

  useEffect(() => {
    if (status.state !== "starting" && status.state !== "running") {
      return undefined;
    }
    let mounted = true;
    let timerId = null;
    const poll = async () => {
      try {
        const pipelineState = await getPipelineStatus("f5");
        if (!mounted) return;
        const f5 = pipelineState.f5 || {};
        const reportedState = f5.status || "idle";
        const state = reportedState === "idle" ? "running" : reportedState;
        setError("");
        setStatus({
          state,
          progress: Number(f5.progress || 0),
          message: f5.message || (reportedState === "idle" ? "F5 build queued..." : "Building F5 historical map..."),
        });
        if (state === "completed") {
          reload();
          return;
        }
        if (state === "failed" || state === "cancelled") {
          setError(f5.error || "F5 analysis did not complete.");
          return;
        }
      } catch {
        if (mounted) setError("Could not read F5 build progress.");
      }
      if (mounted) timerId = window.setTimeout(poll, 1200);
    };
    timerId = window.setTimeout(poll, 350);
    return () => {
      mounted = false;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [reload, status.state]);

  return { status, error, start };
}
