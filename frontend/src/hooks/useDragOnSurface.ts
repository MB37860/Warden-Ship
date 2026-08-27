import { useCallback, useRef } from "react";

export default function useDragOnSurface(onDrag, onEnd) {
  const dragging = useRef(false);
  const lastPoint = useRef(null);

  const update = useCallback((event) => {
    event.stopPropagation();
    const previous = lastPoint.current;
    const current = event.point.clone();
    lastPoint.current = current;
    onDrag(current, previous, event);
  }, [onDrag]);

  return {
    onPointerDown(event) {
      dragging.current = true;
      lastPoint.current = null;
      event.target.setPointerCapture?.(event.pointerId);
      update(event);
    },
    onPointerMove(event) {
      if (dragging.current) update(event);
    },
    onPointerUp(event) {
      dragging.current = false;
      lastPoint.current = null;
      event.target.releasePointerCapture?.(event.pointerId);
      onEnd?.(event);
    },
    onPointerLeave(event) {
      if (!dragging.current) return;
      dragging.current = false;
      lastPoint.current = null;
      onEnd?.(event);
    },
  };
}
