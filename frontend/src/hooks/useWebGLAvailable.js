import { useState } from "react";

function checkWebGLAvailability() {
  if (typeof document === "undefined") {
    return false;
  }

  try {
    const canvas = document.createElement("canvas");
    if (!canvas) {
      return false;
    }

    const gl2 = canvas.getContext("webgl2");
    if (gl2) {
      return true;
    }

    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    return Boolean(gl);
  } catch {
    return false;
  }
}

export default function useWebGLAvailable() {
  const [isAvailable] = useState(() => checkWebGLAvailability());
  return isAvailable;
}
