import { API_BASE } from "./apiBase";

function f5Query(dbName = "") {
  const params = new URLSearchParams();
  if (dbName) params.set("db_name", dbName);
  params.set("_", Date.now().toString());
  return `?${params.toString()}`;
}

function resolveApiUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith("blob:")) return url;
  if (url.startsWith("/")) return `${API_BASE}${url}`;
  return url;
}

function normalizeCoord(coord) {
  const imageUrl = resolveApiUrl(coord.image_url);
  const thumb = resolveApiUrl(coord.thumb || coord.image_url);
  return {
    ...coord,
    image_url: imageUrl,
    thumb,
  };
}

export async function getF5Coords(dbName = "") {
  const response = await fetch(`${API_BASE}/api/f5/coords${f5Query(dbName)}`);
  if (!response.ok) {
    throw new Error("Failed to load F5 coords");
  }
  const payload = await response.json();
  return {
    ...payload,
    coords: Array.isArray(payload.coords) ? payload.coords.map(normalizeCoord) : [],
  };
}
