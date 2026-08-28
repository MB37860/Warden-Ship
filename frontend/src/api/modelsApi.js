import { API_BASE } from "./apiBase";

// The three large trained models are downloaded from the Hugging Face Hub
// rather than shipped in the installer, so the app can be running its weaker
// fallbacks without the user knowing. These two calls are how the interface
// finds out and offers to fix it.

export async function getModelStatus() {
  const response = await fetch(`${API_BASE}/api/models/`);
  if (!response.ok) {
    throw new Error("Failed to read model status");
  }
  return response.json();
}

export async function downloadModels(keys = null) {
  const response = await fetch(`${API_BASE}/api/models/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(keys ? { keys } : {}),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Model download failed to start");
  }
  return response.json();
}
