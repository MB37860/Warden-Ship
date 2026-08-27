import { API_BASE } from "./apiBase";

function f6Query(dbName = "") {
  const params = new URLSearchParams();
  if (dbName) params.set("db_name", dbName);
  params.set("_", Date.now().toString());
  return `?${params.toString()}`;
}

export async function getF6Index(dbName = "") {
  const response = await fetch(`${API_BASE}/api/f6/index${f6Query(dbName)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "F6 index is not available for this database.");
  }
  return payload;
}
