import { useCallback, useEffect, useRef, useState } from "react";

export default function useChestState(setAppState) {
  const [phase, setPhase] = useState("idle");
  const readyTimerRef = useRef(null);

  const clearTimers = useCallback(() => {
    if (readyTimerRef.current) {
      window.clearTimeout(readyTimerRef.current);
      readyTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const openChest = useCallback(() => {
    clearTimers();
    setPhase((current) => {
      if (current === "idle") {
        setAppState("opened");
        return "opened";
      }

      return current;
    });
  }, [clearTimers, setAppState]);

  const triggerOpen = useCallback(
    (file) => {
      if (!file) {
        return;
      }

      clearTimers();
      setPhase("opening");
      setAppState("opening");

      readyTimerRef.current = window.setTimeout(() => {
        setPhase("ready");
        setAppState("ready");
      }, 1250);
    },
    [clearTimers, setAppState],
  );

  return { phase, triggerOpen, openChest };
}
