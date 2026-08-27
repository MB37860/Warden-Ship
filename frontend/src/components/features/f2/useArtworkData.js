import { useCallback, useEffect, useRef, useState } from "react";
import {
  getArtworkArtistName,
  getArtworkDisplayName,
  getArtworkTitleName,
  needsLogbookClassification,
} from "../../../utils/artworkNames";

import { API_BASE } from "../../../api/apiBase";

const EMPTY_FALLBACK_IMAGES = [];

function absoluteApiUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url) || url.startsWith("blob:")) return url;
  return `${API_BASE}${url.startsWith("/") ? url : `/${url}`}`;
}

function dbNameFromImageUrl(url) {
  if (!url || url.startsWith("blob:")) return "";
  try {
    const parsed = new URL(absoluteApiUrl(url));
    return parsed.searchParams.get("db_name") || "";
  } catch {
    return "";
  }
}

function normalizeArtwork(record, index) {
  const id = String(record.id ?? record.fileId ?? record.file_id ?? index);
  const f2Classification = record?.features?.f2 || record?.metadata?.f2 || null;
  const imageUrl = record.imageUrl || record.image_url || "";
  return {
    id,
    fileId: record.fileId ?? record.file_id ?? null,
    title: getArtworkDisplayName(record, `Untitled ${index + 1}`),
    artist: getArtworkArtistName(record, ""),
    artworkTitle: getArtworkTitleName(record, ""),
    f2Classification,
    dbName: record.dbName || record.db_name || dbNameFromImageUrl(imageUrl),
    imageUrl: absoluteApiUrl(imageUrl),
  };
}

function normalizeClassification(payload) {
  const pick = (value) => {
    if (typeof value === "string") return value;
    return value?.label || "Unknown";
  };

  const confidence = payload?.confidence || {};
  return {
    status: "ready",
    genre: pick(payload?.genre),
    style: pick(payload?.style),
    artist: pick(payload?.artist),
    // Open-set artist recognition: the backend rejects paintings that do not
    // match any of the 25 trained artists (label becomes "Unknown artist")
    // and reports the closest known artist separately.
    artistKnown: payload?.artist?.known !== false,
    artistClosest: payload?.artist?.closest?.label || "",
    confidence: {
      genre: Number(confidence.genre ?? payload?.genre?.confidence ?? 0),
      style: Number(confidence.style ?? payload?.style?.confidence ?? 0),
      artist: Number(confidence.artist ?? payload?.artist?.confidence ?? 0),
    },
  };
}

async function fetchArtworks(dbName, signal) {
  const response = await fetch(`${API_BASE}/api/image/images?limit=500&db_name=${encodeURIComponent(dbName)}`, {
    signal,
  });
  if (!response.ok) {
    throw new Error("Failed to load artworks");
  }
  const payload = await response.json();
  const records = payload.images || [];
  return {
    artworks: records
      .filter(needsLogbookClassification)
      .map((record, index) =>
        normalizeArtwork({ ...record, dbName: payload.database || dbName }, index),
      ),
    sourceCount: records.length,
  };
}

async function fetchNonEmptyFallbackArtworks(preferredDbName, signal) {
  const response = await fetch(`${API_BASE}/api/database/list`, { signal });
  if (!response.ok) return [];

  const payload = await response.json().catch(() => ({}));
  const databases = Array.isArray(payload.databases) ? payload.databases : [];
  const nonEmpty = databases.filter(
    (database) =>
      database.name &&
      database.name !== preferredDbName &&
      Number(database.image_count || 0) > 0,
  );

  const fallbackDb =
    nonEmpty.find((database) => database.name === "default") ||
    nonEmpty.sort((a, b) => Number(b.image_count || 0) - Number(a.image_count || 0))[0];

  if (!fallbackDb) return [];

  const result = await fetchArtworks(fallbackDb.name, signal);
  return result.artworks;
}

function normalizeFallbackArtworks(records) {
  return (Array.isArray(records) ? records : [])
    .filter(needsLogbookClassification)
    .map(normalizeArtwork);
}

async function classifyArtwork(artwork, dbName, signal) {
  const classificationDbName = artwork.dbName || dbName;
  const form = new FormData();
  if (artwork.fileId) {
    form.append("file_id", artwork.fileId);
  } else {
    const imageResponse = await fetch(artwork.imageUrl, { signal });
    if (!imageResponse.ok) {
      throw new Error("Unable to read artwork image");
    }
    const blob = await imageResponse.blob();
    form.append("image", new File([blob], "artwork.jpg", { type: blob.type || "image/jpeg" }));
  }
  form.append("db_name", classificationDbName);

  const response = await fetch(`${API_BASE}/api/f2/classify`, {
    method: "POST",
    body: form,
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || "Classification failed");
  }
  return normalizeClassification(payload);
}

export default function useArtworkData(activeSpread = 0, dbName = "default", fallbackImages = EMPTY_FALLBACK_IMAGES) {
  const [artworks, setArtworks] = useState([]);
  const [classifications, setClassifications] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const classificationCacheRef = useRef(new Map());
  const pendingRef = useRef(new Map());

  useEffect(() => {
    const controller = new AbortController();
    classificationCacheRef.current.clear();
    pendingRef.current.clear();
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setClassifications({});
      setIsLoading(true);
      setError("");
    });
    fetchArtworks(dbName, controller.signal)
      .then(async ({ artworks: items, sourceCount }) => {
        const fallbackArtworks = normalizeFallbackArtworks(fallbackImages);
        const storedFallbackArtworks =
          sourceCount === 0 && fallbackArtworks.length === 0
            ? await fetchNonEmptyFallbackArtworks(dbName, controller.signal)
            : [];
        const nextItems =
          sourceCount > 0
            ? items
            : fallbackArtworks.length > 0
              ? fallbackArtworks
              : storedFallbackArtworks;
        const cachedClassifications = {};
        nextItems.forEach((artwork) => {
          if (!artwork.f2Classification) return;
          const classification = normalizeClassification(artwork.f2Classification);
          classificationCacheRef.current.set(artwork.id, classification);
          cachedClassifications[artwork.id] = classification;
        });
        if (Object.keys(cachedClassifications).length > 0) {
          setClassifications(cachedClassifications);
        }
        setArtworks(nextItems);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          const fallbackArtworks = normalizeFallbackArtworks(fallbackImages);
          if (fallbackArtworks.length > 0) {
            setArtworks(fallbackArtworks);
            setError("");
          } else {
            fetchNonEmptyFallbackArtworks(dbName, controller.signal)
              .then((storedFallbackArtworks) => {
                if (controller.signal.aborted) return;
                setArtworks(storedFallbackArtworks);
                setError(storedFallbackArtworks.length > 0 ? "" : err.message || "Failed to load artworks");
              })
              .catch(() => {
                if (controller.signal.aborted) return;
                setError(err.message || "Failed to load artworks");
                setArtworks([]);
              });
          }
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [dbName, fallbackImages]);

  const ensureClassification = useCallback(async (artwork) => {
    if (!artwork || classificationCacheRef.current.has(artwork.id)) {
      return classificationCacheRef.current.get(artwork?.id);
    }
    if (pendingRef.current.has(artwork.id)) {
      return pendingRef.current.get(artwork.id);
    }
    while (pendingRef.current.size >= 2) {
      await Promise.race(pendingRef.current.values());
      if (classificationCacheRef.current.has(artwork.id)) {
        return classificationCacheRef.current.get(artwork.id);
      }
      if (pendingRef.current.has(artwork.id)) {
        return pendingRef.current.get(artwork.id);
      }
    }

    const controller = new AbortController();
    const loadingState = { status: "loading" };
    setClassifications((current) => ({ ...current, [artwork.id]: loadingState }));

    const request = classifyArtwork(artwork, dbName, controller.signal)
      .then((classification) => {
        classificationCacheRef.current.set(artwork.id, classification);
        setClassifications((current) => ({ ...current, [artwork.id]: classification }));
        return classification;
      })
      .catch(() => {
        const damaged = {
          status: "error",
          genre: "unknown",
          style: "unknown",
          artist: "unknown",
          confidence: { genre: 0, style: 0, artist: 0 },
        };
        classificationCacheRef.current.set(artwork.id, damaged);
        setClassifications((current) => ({ ...current, [artwork.id]: damaged }));
        return damaged;
      })
      .finally(() => {
        pendingRef.current.delete(artwork.id);
      });

    pendingRef.current.set(artwork.id, request);
    return request;
  }, [dbName]);

  useEffect(() => {
    if (!artworks.length) return;
    const startSpread = activeSpread;
    const endSpread = activeSpread;
    for (let spread = startSpread; spread <= endSpread; spread += 1) {
      const start = spread * 4;
      artworks.slice(start, start + 4).forEach((artwork) => {
        ensureClassification(artwork);
      });
    }
  }, [activeSpread, artworks, ensureClassification]);

  return {
    artworks,
    classifications,
    isLoading,
    error,
    classificationCacheRef,
    ensureClassification,
  };
}
