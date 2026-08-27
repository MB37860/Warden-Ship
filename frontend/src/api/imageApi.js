import { API_BASE } from "./apiBase";
const UPLOAD_BATCH_SIZE = 25;

let _currentDatabase = "default";

export function setCurrentDatabase(dbName) {
  _currentDatabase = dbName;
}

function normalizeImage(record) {
  return {
    id: record.id,
    fileId: record.file_id,
    filename: record.filename,
    tags: record.tags || [],
    metadata: record.metadata || {},
    features: record.features || {},
    similarity: record.similarity ?? null,
    imageUrl: `${API_BASE}${record.image_url}`,
  };
}

export async function uploadImageBatch(
  files,
  metadataByName = {},
  dbName = null,
  onProgress = null,
) {
  const db = dbName || _currentDatabase;
  const persistedImages = [];

  for (let start = 0; start < files.length; start += UPLOAD_BATCH_SIZE) {
    const batch = files.slice(start, start + UPLOAD_BATCH_SIZE);
    const batchMetadata = Object.fromEntries(
      batch
        .filter((file) => metadataByName[file.name])
        .map((file) => [file.name, metadataByName[file.name]]),
    );
    const form = new FormData();
    batch.forEach((file) => {
      form.append("images", file, file.name);
    });
    form.append("metadata_by_name", JSON.stringify(batchMetadata));
    form.append("db_name", db);

    const response = await fetch(
      `${API_BASE}/api/image/upload-batch?db_name=${encodeURIComponent(db)}`,
      {
        method: "POST",
        body: form,
      },
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const reason = payload.error || "Image upload failed";
      throw new Error(
        `${reason} after ${persistedImages.length} of ${files.length} images were stored`,
      );
    }

    const payload = await response.json();
    persistedImages.push(...(payload.images || []).map(normalizeImage));
    onProgress?.(persistedImages.length, files.length);
  }

  return persistedImages;
}

export async function listImages(limit = 120, dbName = null) {
  const db = dbName || _currentDatabase;
  const response = await fetch(
    `${API_BASE}/api/image/images?limit=${limit}&db_name=${encodeURIComponent(db)}`,
  );
  if (!response.ok) {
    throw new Error("Failed to load images");
  }

  const payload = await response.json();
  return (payload.images || []).map(normalizeImage);
}

export async function checkClipHealth(dbName = null) {
  const db = dbName || _currentDatabase;
  try {
    const response = await fetch(
      `${API_BASE}/api/image/health?db_name=${encodeURIComponent(db)}`,
    );
    if (!response.ok) {
      return false;
    }
    const payload = await response.json();
    return Boolean(payload.clip_available);
  } catch {
    return false;
  }
}

export async function semanticSearch(query, topK = 100, dbName = null) {
  const db = dbName || _currentDatabase;
  const encodedQuery = encodeURIComponent(query);
  const response = await fetch(
    `${API_BASE}/api/image/semantic-search?query=${encodedQuery}&top_k=${topK}&db_name=${encodeURIComponent(db)}`,
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Search failed");
  }

  const payload = await response.json();
  return {
    clipUsed: Boolean(payload.clip_used),
    results: (payload.results || []).map(normalizeImage),
  };
}
