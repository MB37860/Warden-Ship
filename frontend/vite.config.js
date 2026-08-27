import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Relative base so the built app loads correctly from file:// inside Electron.
  // Dev server stays on an absolute base for HMR.
  base: command === "build" ? "./" : "/",
  plugins: [tailwindcss(), react()],
  assetsInclude: ["**/*.glb", "**/*.gltf"],
  build: {
    // The renderer only ever runs in the bundled Electron Chromium, so target a
    // modern engine and skip legacy transforms.
    target: "chrome120",
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Split the heavy 3D stack out of the app shell so the initial paint
        // (and scenes that don't need Three.js) don't pay to parse it.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/three|react-three|postprocessing|@react-spring/.test(id)) {
            return "three";
          }
          if (/framer-motion/.test(id)) return "motion";
          if (/react|scheduler|zustand/.test(id)) return "react-vendor";
          return "vendor";
        },
      },
    },
  },
  server: {
    watch: {
      // This machine has a low inotify instance quota. Polling keeps the
      // development server usable when editors and other tools consume it.
      usePolling: true,
      interval: 400,
      ignored: ["**/src/assets/AGIQA-3K/**"],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
    css: true,
    testTimeout: 15000,
  },
}));
