import { createContext, useContext } from "react";

export const FullscreenImageContext = createContext(null);

const NOOP_VIEWER = { open: () => {}, close: () => {} };

// Any scene can open the shared full-screen artwork viewer with
// `const { open } = useFullscreenImage()`. Falls back to a no-op when a scene
// is rendered outside the provider (e.g. isolated component tests).
export function useFullscreenImage() {
  return useContext(FullscreenImageContext) ?? NOOP_VIEWER;
}
