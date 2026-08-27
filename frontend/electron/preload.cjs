// Minimal, context-isolated preload. The renderer talks to the backend over
// HTTP, so it needs no Node access today. We expose a small, read-only info
// object: the backend's base URL (the port is picked at startup, because 5000
// is often taken by something else) plus versions for diagnostics.

const { contextBridge } = require("electron");

const apiArg = process.argv.find((arg) => arg.startsWith("--warden-ship-api="));

contextBridge.exposeInMainWorld("imageVault", {
  isElectron: true,
  apiBase: apiArg ? apiArg.slice("--warden-ship-api=".length) : null,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
