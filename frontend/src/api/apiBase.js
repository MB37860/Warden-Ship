// Where the Flask backend lives.
//
// In the desktop build the port is decided at launch (5000 is often taken by
// another program) and handed to the renderer through the preload bridge, so
// prefer that over the build-time default.
export const API_BASE =
  (typeof window !== "undefined" && window.imageVault?.apiBase) ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:5000";

export default API_BASE;
