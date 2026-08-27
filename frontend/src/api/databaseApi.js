import { API_BASE } from "./apiBase";

// Database management API

export async function listDatabases() {
  const response = await fetch(`${API_BASE}/api/database/list`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Failed to list databases");
  }
  const payload = await response.json();
  return {
    databases: payload.databases || [],
    mongoAvailable: payload.mongo_available !== false,
    message: payload.message || "",
  };
}

export async function createDatabase(name, description = "") {
  const response = await fetch(`${API_BASE}/api/database/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Failed to create database");
  }
  return await response.json();
}

export async function deleteDatabase(dbName) {
  const response = await fetch(`${API_BASE}/api/database/delete/${dbName}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Failed to delete database");
  }
  return await response.json();
}
