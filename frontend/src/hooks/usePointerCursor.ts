import { useEffect } from "react";

export default function usePointerCursor(active) {
  useEffect(() => {
    if (!active) return undefined;
    const previous = document.body.style.cursor;
    document.body.style.cursor = "pointer";
    return () => {
      document.body.style.cursor = previous;
    };
  }, [active]);
}
