"""
F5 History Map Pipeline Runner
==============================

Builds the art-history timeline/style-map artifacts used by the F5 frontend.

The proposal describes a learned activation space reduced into navigable 2D/3D
maps. In this implementation we use the strongest signal available for the
uploaded archive:

- CLIP embeddings already stored in MongoDB metadata when present.
- Runtime CLIP embeddings when the model is available locally.
- Handcrafted visual descriptors as a dependable fallback and companion signal.

The final artifacts are PCA projections, clusters, neighbors, timeline metadata,
and short interpretation axes inspired by the reports/recent-work papers.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import math
import os
import re
import sys
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageStat

try:
    from backend.pipeline_state_store import write_pipeline_state
except ModuleNotFoundError:  # Keep direct script usage working.
    write_pipeline_state = None

try:
    from backend.f5_history_map.year_head import (
        predict_years_from_clip,
        year_head_available,
        year_head_metrics,
    )
except ModuleNotFoundError:  # Keep direct script usage working.
    try:
        from year_head import predict_years_from_clip, year_head_available, year_head_metrics
    except ModuleNotFoundError:
        predict_years_from_clip = None
        year_head_available = None
        year_head_metrics = None

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"}
MANIFEST_NAME = "_mongo_manifest.json"
MAX_IMAGES = 1200

CLUSTER_COLORS = [
    "#d8a24a",
    "#6fb6c8",
    "#d76f54",
    "#7ebf7a",
    "#b988d8",
    "#d6c06c",
    "#6f87c8",
    "#d58aa5",
]

ERA_BANDS = [
    {"id": "medieval", "label": "Before 1400", "start": 800, "end": 1399},
    {"id": "renaissance", "label": "Renaissance", "start": 1400, "end": 1599},
    {"id": "baroque", "label": "Baroque", "start": 1600, "end": 1749},
    {"id": "academy", "label": "1750-1879", "start": 1750, "end": 1879},
    {"id": "modern", "label": "Modern", "start": 1880, "end": 1945},
    {"id": "contemporary", "label": "Contemporary", "start": 1946, "end": 2026},
]

# Works whose date could not be established. They stay on the map but never
# receive a fabricated year - see _fill_years_with_model.
UNDATED_ERA = {"id": "undated", "label": "Undated", "start": None, "end": None}

# A year taken from a catalogue, a filename or the WikiArt table is a fact.
# artist_lifetime (guessed from the artist's dates) and model_estimate (the
# trained year head) are not, and the interface has to tell them apart.
EXACT_YEAR_SOURCES = {"metadata", "filename", "wikiart"}

FEATURE_NAMES = [
    "mean_red",
    "mean_green",
    "mean_blue",
    "std_red",
    "std_green",
    "std_blue",
    "contrast",
    "edge_density",
    "saturation",
    "brightness",
    "warmth",
    "aspect_ratio",
    "center_light",
    "composition_balance",
    "entropy",
]


def _now_iso() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _json_safe(value: Any) -> Any:
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.floating):
        return float(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


def _write_state(
    state_file: Path | None,
    pipeline_name: str,
    *,
    progress: float,
    stage: str,
    message: str,
    status: str = "running",
    can_use: bool = False,
    extra: dict[str, Any] | None = None,
) -> None:
    if state_file is None:
        return

    if write_pipeline_state is not None:
        try:
            write_pipeline_state(
                state_file,
                pipeline_name,
                progress=progress,
                stage=stage,
                message=message,
                status=status,
                can_use=can_use,
                extra=extra,
            )
            return
        except Exception:
            logger.debug("Could not update pipeline state", exc_info=True)
            return

    try:
        if state_file.exists():
            with state_file.open("r", encoding="utf-8") as handle:
                state = json.load(handle)
        else:
            state = {}

        previous = state.get(pipeline_name, {})
        payload = {
            "status": status,
            "progress": max(0, min(100, int(round(progress)))),
            "stage": stage,
            "message": message,
            "can_use": can_use,
            "started_at": previous.get("started_at", time.time()),
            "updated_at": time.time(),
            "error": None,
        }
        if status in {"completed", "failed", "cancelled"}:
            payload["completed_at"] = time.time()
        if extra:
            payload.update(extra)

        state[pipeline_name] = payload
        tmp_path = state_file.with_suffix(state_file.suffix + ".tmp")
        with tmp_path.open("w", encoding="utf-8") as handle:
            json.dump(state, handle)
        tmp_path.replace(state_file)
    except Exception:
        logger.debug("Could not update pipeline state", exc_info=True)


def _slug(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("_", " ").replace("-", " ")).strip()


def _load_manifest(image_root: Path) -> dict[str, dict[str, Any]]:
    manifest_path = image_root / MANIFEST_NAME
    if not manifest_path.exists():
        return {}

    try:
        with manifest_path.open("r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except Exception:
        logger.warning("Could not read %s", manifest_path, exc_info=True)
        return {}

    records = raw.get("images", raw if isinstance(raw, list) else [])
    manifest: dict[str, dict[str, Any]] = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        keys = {
            str(record.get("relative_path") or ""),
            str(record.get("path") or ""),
            str(record.get("filename") or ""),
        }
        for key in keys:
            if key:
                manifest[key] = record
    return manifest


def _scan_images(image_root: Path) -> list[Path]:
    paths = [
        path
        for path in image_root.rglob("*")
        if path.is_file()
        and path.suffix.lower() in IMAGE_EXTENSIONS
        and not path.name.startswith(".")
    ]
    paths = sorted(set(paths), key=lambda item: str(item.relative_to(image_root)).lower())
    return paths[:MAX_IMAGES]


def _manifest_for(path: Path, image_root: Path, manifest: dict[str, dict[str, Any]]) -> dict[str, Any]:
    rel = str(path.relative_to(image_root))
    return manifest.get(rel) or manifest.get(path.name) or {}


def _first_metadata_value(metadata: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        value = metadata.get(key)
        if value not in (None, ""):
            return value
    return None


@lru_cache(maxsize=1)
def _wikiart_lookup() -> dict[str, dict[str, Any]]:
    parquet_path = Path(__file__).resolve().parents[2] / "data" / "WikiArt_dataset" / "WikiArt.parquet"
    if not parquet_path.exists():
        logger.warning(
            "WikiArt metadata not found at %s - artworks without a date in their "
            "filename or metadata now depend entirely on the trained year head.",
            parquet_path,
        )
        return {}

    try:
        import pandas as pd

        columns = [
            "filename",
            "artist",
            "title",
            "completion",
            "styles",
            "genres",
            "artist_birth",
            "artist_death",
        ]
        frame = pd.read_parquet(parquet_path, columns=columns)
        lookup: dict[str, dict[str, Any]] = {}
        for row in frame.to_dict("records"):
            filename = str(row.get("filename") or "")
            if not filename:
                continue
            lookup[filename] = row
        return lookup
    except Exception:
        # Swallowing this silently is how an entire dataset ends up with invented
        # dates: pandas raises ImportError here when no parquet engine (pyarrow)
        # is installed, the lookup returns empty, and every year gets estimated.
        logger.warning(
            "Could not read WikiArt metadata from %s - artwork dates will be "
            "FABRICATED. Is a parquet engine (pyarrow) installed?",
            parquet_path,
            exc_info=True,
        )
        return {}


def _wikiart_record_for(record: dict[str, Any], path: Path) -> dict[str, Any]:
    lookup = _wikiart_lookup()
    if not lookup:
        return {}

    for key in [
        record.get("filename"),
        record.get("relative_path"),
        record.get("path"),
        path.name,
    ]:
        if key and str(key) in lookup:
            return lookup[str(key)]
    return {}


def _first_wikiart_term(value: Any) -> str | None:
    """WikiArt stores styles and genres as lists; the atlas needs one term."""
    if isinstance(value, (list, tuple, np.ndarray)):
        for item in value:
            text = str(item).strip()
            if text and text.lower() != "nan":
                return text
        return None
    text = str(value or "").strip()
    return text or None if text.lower() != "nan" else None


def _year_from_wikiart(record: dict[str, Any], path: Path) -> tuple[int | None, str]:
    wiki = _wikiart_record_for(record, path)
    if not wiki:
        return None, "unknown"

    completion = wiki.get("completion")
    try:
        if completion is not None and not (isinstance(completion, float) and math.isnan(completion)):
            year = int(float(completion))
            if 800 <= year <= 2026:
                return year, "wikiart"
    except Exception:
        pass

    birth = _parse_year_from_text(str(wiki.get("artist_birth") or ""))
    death = _parse_year_from_text(str(wiki.get("artist_death") or ""))
    if birth and death:
        year = int(round(birth + (death - birth) * 0.62))
        return max(800, min(2026, year)), "artist_lifetime"
    if birth:
        return max(800, min(2026, birth + 40)), "artist_lifetime"
    if death:
        return max(800, min(2026, death - 22)), "artist_lifetime"

    return None, "unknown"


def _parse_year_from_text(text: str) -> int | None:
    if not text:
        return None

    candidates: list[int] = []
    for match in re.finditer(r"(?<!\d)([1-2]\d{3}|9\d{2}|8\d{2})(?!\d)", text):
        start, end = match.span()
        before = text[start - 1 : start].lower()
        after = text[end : end + 1].lower()
        if before in {"x", "×"} or after in {"x", "×"}:
            continue
        value = int(match.group(1))
        if 800 <= value <= 2026:
            candidates.append(value)

    if not candidates:
        return None

    # If a filename contains several years, the earliest is usually the creation
    # year while later values tend to be catalog or upload years.
    return min(candidates)


def _known_year(record: dict[str, Any], path: Path) -> tuple[int | None, str]:
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
    raw = _first_metadata_value(
        metadata,
        [
            "year",
            "date",
            "creation_year",
            "created_year",
            "completion_year",
            "artist_year",
        ],
    )
    parsed = _parse_year_from_text(str(raw or ""))
    if parsed is not None:
        return parsed, "metadata"

    for field in ["filename", "title", "caption", "path", "relative_path"]:
        value = record.get(field) if field in record else metadata.get(field)
        parsed = _parse_year_from_text(str(value or ""))
        if parsed is not None:
            return parsed, "filename"

    parsed = _parse_year_from_text(path.stem)
    if parsed is not None:
        return parsed, "filename"

    wiki_year, wiki_source = _year_from_wikiart(record, path)
    if wiki_year is not None:
        return wiki_year, wiki_source

    return None, "unknown"


def _era_for_year(year: int | None) -> dict[str, Any]:
    if year is None:
        return UNDATED_ERA
    for era in ERA_BANDS:
        if era["start"] <= year <= era["end"]:
            return era
    return ERA_BANDS[0] if year < ERA_BANDS[0]["start"] else ERA_BANDS[-1]


def _date_label(year: int | None, source: str) -> str:
    """What the interface shows. An estimate must never read like a catalogue date."""
    if year is None:
        return "undated"
    if source in EXACT_YEAR_SOURCES:
        return str(year)
    return f"c. {year} (estimated)"


def _entropy(values: np.ndarray) -> float:
    hist, _ = np.histogram(values, bins=32, range=(0.0, 1.0), density=False)
    probs = hist.astype(np.float64)
    total = probs.sum()
    if total <= 0:
        return 0.0
    probs = probs[probs > 0] / total
    return float(-np.sum(probs * np.log2(probs)) / 5.0)


def _image_profile(path: Path) -> tuple[np.ndarray, dict[str, Any]]:
    with Image.open(path) as image:
        rgb = image.convert("RGB")
        width, height = rgb.size
        small = rgb.resize((96, 96))
        arr = np.asarray(small, dtype=np.float32) / 255.0
        flat = arr.reshape(-1, 3)

        gray = np.dot(arr, np.array([0.299, 0.587, 0.114], dtype=np.float32))
        gx = np.abs(np.diff(gray, axis=1)).mean()
        gy = np.abs(np.diff(gray, axis=0)).mean()
        edge_density = float((gx + gy) * 2.4)
        contrast = float(gray.std())

        hsv = np.asarray(small.convert("HSV"), dtype=np.float32)
        hue = hsv[..., 0].reshape(-1) / 255.0
        saturation = hsv[..., 1].reshape(-1) / 255.0
        value = hsv[..., 2].reshape(-1) / 255.0

        hue_hist, _ = np.histogram(hue, bins=16, range=(0.0, 1.0), density=False)
        sat_hist, _ = np.histogram(saturation, bins=6, range=(0.0, 1.0), density=False)
        val_hist, _ = np.histogram(value, bins=6, range=(0.0, 1.0), density=False)
        rgb_hist_parts = [
            np.histogram(flat[:, channel], bins=8, range=(0.0, 1.0), density=False)[0]
            for channel in range(3)
        ]

        def norm_hist(hist: np.ndarray) -> np.ndarray:
            total = max(float(hist.sum()), 1.0)
            return hist.astype(np.float32) / total

        mean = flat.mean(axis=0)
        std = flat.std(axis=0)
        warmth = float(mean[0] - mean[2])
        center = gray[28:68, 28:68]
        left = gray[:, :48].mean()
        right = gray[:, 48:].mean()
        top = gray[:48, :].mean()
        bottom = gray[48:, :].mean()
        composition_balance = float(1.0 - min(abs(left - right) + abs(top - bottom), 1.0))
        entropy = _entropy(gray.reshape(-1))
        aspect = float(width / max(height, 1))

        vector = np.concatenate(
            [
                mean,
                std,
                np.array(
                    [
                        contrast,
                        edge_density,
                        float(saturation.mean()),
                        float(value.mean()),
                        warmth,
                        aspect,
                        float(center.mean()),
                        composition_balance,
                        entropy,
                    ],
                    dtype=np.float32,
                ),
                norm_hist(hue_hist),
                norm_hist(sat_hist),
                norm_hist(val_hist),
                *[norm_hist(part) for part in rgb_hist_parts],
            ]
        ).astype(np.float32)

        stat = ImageStat.Stat(rgb)
        dominant_hue = int(np.argmax(hue_hist))
        visual = {
            "width": int(width),
            "height": int(height),
            "aspect_ratio": aspect,
            "mean_rgb": [round(float(channel), 4) for channel in mean],
            "std_rgb": [round(float(channel), 4) for channel in std],
            "brightness": round(float(value.mean()), 4),
            "saturation": round(float(saturation.mean()), 4),
            "contrast": round(contrast, 4),
            "edge_density": round(edge_density, 4),
            "warmth": round(warmth, 4),
            "entropy": round(entropy, 4),
            "dominant_hue_bin": dominant_hue,
            "average_color": [int(round(channel)) for channel in stat.mean],
        }

    return vector, visual


def _standardize(matrix: np.ndarray) -> np.ndarray:
    if matrix.size == 0:
        return matrix
    mean = matrix.mean(axis=0, keepdims=True)
    std = matrix.std(axis=0, keepdims=True)
    std = np.where(std < 1e-6, 1.0, std)
    return (matrix - mean) / std


def _pca(matrix: np.ndarray, dims: int = 10) -> tuple[np.ndarray, np.ndarray]:
    n = matrix.shape[0]
    if n == 0:
        return np.zeros((0, dims), dtype=np.float32), np.zeros(dims, dtype=np.float32)
    if n == 1:
        return np.zeros((1, dims), dtype=np.float32), np.zeros(dims, dtype=np.float32)

    centered = matrix - matrix.mean(axis=0, keepdims=True)
    u, singular_values, _ = np.linalg.svd(centered, full_matrices=False)
    usable = min(dims, u.shape[1])
    coords = np.zeros((n, dims), dtype=np.float32)
    coords[:, :usable] = (u[:, :usable] * singular_values[:usable]).astype(np.float32)

    eigen = (singular_values**2) / max(n - 1, 1)
    total = float(eigen.sum())
    explained = np.zeros(dims, dtype=np.float32)
    if total > 0:
        explained[:usable] = (eigen[:usable] / total).astype(np.float32)
    return coords, explained


def _normalize_axis(values: np.ndarray) -> np.ndarray:
    if values.size == 0:
        return values
    lo = float(np.percentile(values, 3))
    hi = float(np.percentile(values, 97))
    if abs(hi - lo) < 1e-8:
        return np.zeros_like(values, dtype=np.float32)
    normalized = ((values - lo) / (hi - lo)) * 2.0 - 1.0
    return np.clip(normalized, -1.0, 1.0).astype(np.float32)


def _normalize_coords(coords: np.ndarray, dims: int = 3) -> np.ndarray:
    out = np.zeros((coords.shape[0], dims), dtype=np.float32)
    for axis in range(dims):
        if axis < coords.shape[1]:
            out[:, axis] = _normalize_axis(coords[:, axis])
    return out


def _fill_years_with_model(
    known_years: list[int | None],
    year_sources: list[str],
    clip_matrix: np.ndarray | None = None,
) -> tuple[list[int | None], list[str], list[float | None]]:
    """Date the works that carry no date, using the trained year head only.

    There is deliberately no geometric fallback here. Where a work sits in the
    projected style space is not evidence of when it was painted, and a date
    invented from that position is worse than no date at all: it reaches the
    interface looking exactly like a catalogue year. Works the head cannot be
    run on keep ``year = None`` and are shown as undated.
    """
    years: list[int | None] = list(known_years)
    sources = list(year_sources)
    confidences: list[float | None] = [None] * len(years)

    missing = [idx for idx, year in enumerate(years) if year is None]
    if not missing:
        return years, sources, confidences

    if predict_years_from_clip is None or clip_matrix is None or clip_matrix.shape[0] != len(years):
        logger.warning(
            "No CLIP vectors for the F5 year head; %s works stay undated", len(missing)
        )
        return years, sources, confidences

    predicted = predict_years_from_clip(clip_matrix[missing])
    if predicted is None:
        logger.warning("F5 year head unavailable; %s works stay undated", len(missing))
        return years, sources, confidences

    model_years, model_confidence = predicted
    for offset, idx in enumerate(missing):
        years[idx] = int(max(800, min(2026, round(float(model_years[offset])))))
        sources[idx] = "model_estimate"
        confidences[idx] = round(float(model_confidence[offset]), 4)

    return years, sources, confidences


def _orient_projection(coords: np.ndarray, years: list[int | None]) -> np.ndarray:
    """Flip the first axis so it runs old -> recent, judging only by dated works."""
    dated = [idx for idx, year in enumerate(years) if year is not None]
    if coords.shape[0] < 3 or len(dated) < 3 or coords.shape[1] < 1:
        return coords
    years_arr = np.asarray([years[idx] for idx in dated], dtype=np.float32)
    axis_values = coords[dated, 0]
    if np.std(axis_values) < 1e-6 or np.std(years_arr) < 1e-6:
        return coords
    out = coords.copy()
    if float(np.corrcoef(axis_values, years_arr)[0, 1]) < 0:
        out[:, 0] *= -1
    return out


def _cosine_matrix(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms = np.clip(norms, 1e-8, None)
    normalized = matrix / norms
    return normalized @ normalized.T


def _kmeans(matrix: np.ndarray, k: int, max_iter: int = 45) -> tuple[np.ndarray, np.ndarray]:
    n = matrix.shape[0]
    if n == 0:
        return np.zeros(0, dtype=np.int32), np.zeros((0, matrix.shape[1]), dtype=np.float32)
    if k <= 1 or n == 1:
        return np.zeros(n, dtype=np.int32), matrix[:1].copy()

    k = min(k, n)
    centers = [matrix[0]]
    while len(centers) < k:
        stacked = np.vstack(centers)
        dist = ((matrix[:, None, :] - stacked[None, :, :]) ** 2).sum(axis=2).min(axis=1)
        centers.append(matrix[int(np.argmax(dist))])
    centroids = np.vstack(centers).astype(np.float32)
    labels = np.zeros(n, dtype=np.int32)

    for _ in range(max_iter):
        distances = ((matrix[:, None, :] - centroids[None, :, :]) ** 2).sum(axis=2)
        next_labels = np.argmin(distances, axis=1).astype(np.int32)
        if np.array_equal(next_labels, labels):
            break
        labels = next_labels
        for cluster_id in range(k):
            members = matrix[labels == cluster_id]
            if len(members):
                centroids[cluster_id] = members.mean(axis=0)
    return labels, centroids


def _cluster_name(visuals: list[dict[str, Any]], indices: list[int]) -> str:
    if not indices:
        return "Open route"

    brightness = float(np.mean([visuals[idx]["brightness"] for idx in indices]))
    saturation = float(np.mean([visuals[idx]["saturation"] for idx in indices]))
    edge = float(np.mean([visuals[idx]["edge_density"] for idx in indices]))
    contrast = float(np.mean([visuals[idx]["contrast"] for idx in indices]))
    warmth = float(np.mean([visuals[idx]["warmth"] for idx in indices]))

    if edge > 0.23 and contrast > 0.2:
        return "Linear rigging"
    if brightness < 0.34:
        return "Deep-toned hold"
    if saturation > 0.42 and warmth > 0:
        return "Warm pigment route"
    if saturation > 0.42:
        return "Bright pigment route"
    if brightness > 0.68:
        return "Light-washed deck"
    if contrast < 0.14:
        return "Soft atmosphere"
    return "Balanced chart room"


def _cluster_summaries(
    labels: np.ndarray,
    centroids: np.ndarray,
    cluster_space: np.ndarray,
    visuals: list[dict[str, Any]],
    entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for cluster_id in range(centroids.shape[0]):
        indices = [idx for idx, label in enumerate(labels) if int(label) == cluster_id]
        if not indices:
            continue
        distances = np.linalg.norm(cluster_space[indices] - centroids[cluster_id], axis=1)
        representative_local = int(np.argmin(distances))
        representative_index = indices[representative_local]
        years = [entries[idx]["year"] for idx in indices if entries[idx]["year"] is not None]
        summaries.append(
            {
                "id": int(cluster_id),
                "label": _cluster_name(visuals, indices),
                "color": CLUSTER_COLORS[cluster_id % len(CLUSTER_COLORS)],
                "count": len(indices),
                "year_min": int(min(years)) if years else None,
                "year_max": int(max(years)) if years else None,
                "representative_id": entries[representative_index]["id"],
                "representative_label": entries[representative_index]["title"],
                "centroid": _json_safe(centroids[cluster_id, :3]),
            }
        )
    return summaries


def _neighbor_payload(
    similarity: np.ndarray,
    labels: np.ndarray,
    entries: list[dict[str, Any]],
    index: int,
    top_k: int = 5,
) -> tuple[list[dict[str, Any]], float]:
    if similarity.shape[0] <= 1:
        return [], 0.0
    order = np.argsort(-similarity[index])
    neighbors: list[dict[str, Any]] = []
    neighbor_clusters: list[int] = []
    for neighbor_index in order:
        if int(neighbor_index) == index:
            continue
        neighbor_clusters.append(int(labels[neighbor_index]))
        neighbors.append(
            {
                "id": entries[neighbor_index]["id"],
                "label": entries[neighbor_index]["title"],
                "year": entries[neighbor_index]["year"],
                "cluster_id": int(labels[neighbor_index]),
                "similarity": round(float(similarity[index, neighbor_index]), 4),
            }
        )
        if len(neighbors) >= top_k:
            break

    diversity = len(set(neighbor_clusters)) / max(len(neighbor_clusters), 1)
    return neighbors, float(diversity)


def _resolve_arcface_model() -> Path | None:
    """Locate the art-tuned ArcFace embedding (TorchScript, see f1_embedding).

    Env override F5_EMBED_MODEL_PATH > data/f1_embed in a checkout > the public
    Hub repo, downloaded and cached on first use. None when it cannot be found
    at all, which drops the map back to visual descriptors.
    """
    override = os.getenv("F5_EMBED_MODEL_PATH", "").strip()
    if override:
        candidate = Path(override).expanduser()
        return candidate if candidate.exists() else None
    try:
        from backend.api import model_assets
    except Exception:
        return None
    return model_assets.resolve_file("f1_embed", "f1_embed_model.pt")


def _try_arcface_embeddings(image_paths: list[Path]) -> np.ndarray | None:
    """Embed images with the ArcFace metric model (style-aware neighbourhoods).

    The exported TorchScript module takes float images in [0,1], [B,3,224,224]
    (normalisation is baked in) and returns L2-normalised 512-d embeddings.
    Trained so same-style works cluster together (test p@1 0.61 vs 0.42 for raw
    CLIP), which is exactly what the F5 map clustering needs.
    """
    model_path = _resolve_arcface_model()
    if model_path is None:
        return None
    try:
        import torch
        from PIL import Image
    except Exception:
        return None

    try:
        model = torch.jit.load(str(model_path), map_location="cpu")
        model.eval()
    except Exception:
        logger.info("ArcFace embedding model could not be loaded; falling back", exc_info=True)
        return None

    size = 224
    resize_to = int(size * 256 / 224)

    def _preprocess(path: Path):
        with Image.open(path) as im:
            image = im.convert("RGB")
            w, h = image.size
            new = (resize_to, max(1, round(h * resize_to / w))) if w <= h else (max(1, round(w * resize_to / h)), resize_to)
            image = image.resize(new, Image.BICUBIC)
            w, h = image.size
            left, top = (w - size) // 2, (h - size) // 2
            image = image.crop((left, top, left + size, top + size))
            array = np.asarray(image, dtype=np.float32) / 255.0
            return torch.from_numpy(array.transpose(2, 0, 1))

    embeddings: list[np.ndarray] = []
    batch_size = 16
    try:
        for start in range(0, len(image_paths), batch_size):
            batch_paths = image_paths[start : start + batch_size]
            tensor = torch.stack([_preprocess(path) for path in batch_paths])
            with torch.inference_mode():
                vectors = model(tensor)
            embeddings.append(vectors.detach().cpu().numpy().astype(np.float32))
    except Exception:
        logger.info("ArcFace embeddings failed; falling back", exc_info=True)
        return None

    if not embeddings:
        return None
    return np.vstack(embeddings).astype(np.float32)


def _try_clip_embeddings(image_paths: list[Path]) -> np.ndarray | None:
    """CLIP vectors for the map, using whichever weights the app is running."""
    if os.getenv("F5_RUNTIME_CLIP", "0") != "1":
        return None
    try:
        from backend.api.clip_service import embed_images
    except Exception:
        return None
    return _embed_with(embed_images, image_paths)


def _base_clip_tag() -> str | None:
    """The ``embedding_model`` tag clip_service stamps on base-CLIP vectors.

    None when clip_service cannot be imported (this module also runs standalone),
    in which case a stored vector's provenance cannot be verified and it must not
    reach the year head.
    """
    try:
        from backend.api.clip_service import BASE_CLIP_TAG
    except Exception:
        return None
    return BASE_CLIP_TAG


def _base_clip_embeddings(image_paths: list[Path]) -> np.ndarray | None:
    """CLIP vectors for the year head, pinned to the base weights.

    Deliberately not behind ``F5_RUNTIME_CLIP``: that flag exists to keep the
    map from recomputing CLIP it does not need, whereas the head has no other
    source of the vectors it was trained on. If base CLIP cannot be loaded the
    caller gets None and the works stay undated, which is the honest outcome.
    """
    try:
        from backend.api.clip_service import embed_images_base
    except Exception:
        return None
    return _embed_with(embed_images_base, image_paths)


def _embed_with(embed_fn, image_paths: list[Path]) -> np.ndarray | None:
    embeddings: list[np.ndarray] = []
    batch_size = 16
    try:
        for start in range(0, len(image_paths), batch_size):
            raws = [path.read_bytes() for path in image_paths[start : start + batch_size]]
            batch = embed_fn(raws)
            if batch is None:
                return None
            embeddings.append(batch.astype(np.float32))
    except Exception:
        logger.info("Runtime CLIP embeddings unavailable; using visual descriptors", exc_info=True)
        return None

    if not embeddings:
        return None
    return np.vstack(embeddings).astype(np.float32)


def _manifest_embeddings(
    records: list[dict[str, Any]],
    *,
    require_model: str | None = None,
) -> np.ndarray | None:
    """Stored Mongo vectors, optionally restricted to one CLIP.

    ``require_model`` rejects the whole batch unless every record was embedded
    with those weights. An untagged record is rejected too: it predates the tag
    and there is no way to prove which encoder produced it.
    """
    vectors: list[list[float]] = []
    expected_len: int | None = None
    for record in records:
        embedding = record.get("embedding")
        if not isinstance(embedding, list) or not embedding:
            return None
        if require_model is not None and record.get("embedding_model") != require_model:
            return None
        if expected_len is None:
            expected_len = len(embedding)
        if len(embedding) != expected_len:
            return None
        vectors.append([float(value) for value in embedding])
    if len(vectors) < 2:
        return None
    return np.asarray(vectors, dtype=np.float32)


def generate_history_index(
    image_root: Path,
    output_dir: Path,
    *,
    state_file: Path | None = None,
    pipeline_name: str = "f5",
) -> bool:
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        _write_state(
            state_file,
            pipeline_name,
            progress=8,
            stage="scan",
            message="Scanning the archive for paintings",
        )

        manifest = _load_manifest(image_root)
        image_files = _scan_images(image_root)
        if not image_files:
            for file_name, payload in {
                "index.json": [],
                "coords.json": [],
                "summary.json": {
                    "ok": True,
                    "generated_at": _now_iso(),
                    "records": 0,
                    "message": "No images found",
                },
            }.items():
                with (output_dir / file_name).open("w", encoding="utf-8") as handle:
                    json.dump(payload, handle, indent=2)
            _write_state(
                state_file,
                pipeline_name,
                progress=100,
                stage="ready",
                message="F5 history map ready, but no images were found",
                status="completed",
                can_use=True,
            )
            return True

        logger.info("Found %s images for F5", len(image_files))

        visual_vectors: list[np.ndarray] = []
        visuals: list[dict[str, Any]] = []
        records: list[dict[str, Any]] = []
        used_image_files: list[Path] = []
        known_years: list[int | None] = []
        year_sources: list[str] = []

        for index, image_path in enumerate(image_files):
            progress = 10 + 30 * ((index + 1) / max(len(image_files), 1))
            if index == 0 or index % 10 == 0 or index == len(image_files) - 1:
                _write_state(
                    state_file,
                    pipeline_name,
                    progress=progress,
                    stage="features",
                    message=f"Reading visual structure {index + 1}/{len(image_files)}",
                    extra={"current": index + 1, "total": len(image_files)},
                )

            try:
                vector, visual = _image_profile(image_path)
            except Exception as exc:
                logger.warning("Skipping %s: %s", image_path, exc)
                continue

            record = _manifest_for(image_path, image_root, manifest)
            rel_path = str(image_path.relative_to(image_root))
            metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
            wiki_record = _wikiart_record_for(record, image_path)
            title = (
                metadata.get("title")
                or wiki_record.get("title")
                or metadata.get("caption")
                or record.get("title")
                or record.get("filename")
                or image_path.stem
            )
            artist = metadata.get("artist") or metadata.get("author") or record.get("artist") or wiki_record.get("artist")
            year, year_source = _known_year(record, image_path)
            # The star atlas arranges by style or genre; for catalogued works the
            # WikiArt table is the authority, and F2's prediction covers the rest.
            style = _first_metadata_value(metadata, ["style", "movement"]) or _first_wikiart_term(wiki_record.get("styles"))
            genre = _first_metadata_value(metadata, ["genre"]) or _first_wikiart_term(wiki_record.get("genres"))

            visual_vectors.append(vector)
            visuals.append(visual)
            used_image_files.append(image_path)
            known_years.append(year)
            year_sources.append(year_source)
            records.append(
                {
                    "id": str(record.get("id") or record.get("file_id") or rel_path),
                    "file_id": record.get("file_id"),
                    "path": rel_path,
                    "filename": str(record.get("filename") or image_path.name),
                    "title": _slug(str(title)),
                    "artist": _slug(str(artist)) if artist else None,
                    "image_url": record.get("image_url"),
                    "metadata": metadata,
                    "tags": record.get("tags") or [],
                    "year": year,
                    "year_source": year_source,
                    "style": style,
                    "genre": genre,
                }
            )

        if not records:
            raise RuntimeError("No readable images found")

        visual_matrix = np.vstack(visual_vectors).astype(np.float32)
        embedding_source = "visual_descriptors"

        # Preferred: the art-tuned ArcFace metric embedding (same-style works
        # cluster together), then stored CLIP vectors, then runtime CLIP.
        _write_state(
            state_file,
            pipeline_name,
            progress=44,
            stage="embedding",
            message="Checking for neural image embeddings",
        )
        embedding_matrix = _try_arcface_embeddings(used_image_files)
        if embedding_matrix is not None:
            embedding_source = "arcface_plus_visual_descriptors"
        else:
            embedding_matrix = _manifest_embeddings(
                [_manifest_for(path, image_root, manifest) for path in used_image_files]
            )
            if embedding_matrix is not None:
                embedding_source = "mongo_clip_plus_visual_descriptors"
            else:
                embedding_matrix = _try_clip_embeddings(used_image_files)
                if embedding_matrix is not None:
                    embedding_source = "runtime_clip_plus_visual_descriptors"

        visual_standard = _standardize(visual_matrix)
        if embedding_matrix is not None and embedding_matrix.shape[0] == visual_standard.shape[0]:
            combined = np.concatenate([_standardize(embedding_matrix) * 0.85, visual_standard * 0.35], axis=1)
        else:
            combined = visual_standard

        _write_state(
            state_file,
            pipeline_name,
            progress=58,
            stage="projection",
            message="Reducing the style space into 2D and 3D maps",
        )
        pca_coords, explained = _pca(combined, dims=10)
        normalized_coords = _normalize_coords(pca_coords, dims=3)

        # The trained year head consumes BASE CLIP vectors specifically - it was
        # fitted on WikiArt's openai/clip-vit-base-patch32 embeddings. The app
        # normally runs the art fine-tune, which keeps the same 512-d output, so
        # a mismatch produces no error at all, just confident nonsense. Hence:
        # never reuse the map's embedding_matrix here, take stored vectors only
        # when they are tagged base, and otherwise recompute with base CLIP -
        # and only when there is actually a year to estimate.
        clip_matrix = None
        if (
            year_head_available is not None
            and year_head_available()
            and any(year is None for year in known_years)
        ):
            base_tag = _base_clip_tag()
            if base_tag is not None:
                clip_matrix = _manifest_embeddings(
                    [_manifest_for(path, image_root, manifest) for path in used_image_files],
                    require_model=base_tag,
                )
            if clip_matrix is None:
                clip_matrix = _base_clip_embeddings(used_image_files)

        resolved_years, year_sources, year_confidences = _fill_years_with_model(
            known_years, year_sources, clip_matrix
        )
        normalized_coords = _orient_projection(normalized_coords, resolved_years)

        for index, year in enumerate(resolved_years):
            records[index]["year"] = int(year) if year is not None else None
            records[index]["year_source"] = year_sources[index]
            records[index]["year_confidence"] = year_confidences[index]
            records[index]["era"] = _era_for_year(records[index]["year"])

        _write_state(
            state_file,
            pipeline_name,
            progress=70,
            stage="cluster",
            message="Finding style routes and neighboring works",
        )
        cluster_space = _standardize(np.column_stack([pca_coords[:, : min(6, pca_coords.shape[1])], visual_standard[:, :10]]))
        cluster_count = 1 if len(records) < 3 else min(8, max(2, int(round(math.sqrt(len(records) / 2)))))
        labels, centroids = _kmeans(cluster_space, cluster_count)
        similarity = _cosine_matrix(combined)
        cluster_summaries = _cluster_summaries(labels, centroids, cluster_space, visuals, records)
        cluster_by_id = {cluster["id"]: cluster for cluster in cluster_summaries}

        index_payload: list[dict[str, Any]] = []
        coords_payload: list[dict[str, Any]] = []

        distances_to_centroid = np.linalg.norm(cluster_space - centroids[labels], axis=1) if len(records) else np.zeros(0)
        max_distance = max(float(distances_to_centroid.max()), 1e-8) if len(distances_to_centroid) else 1.0

        for index, record in enumerate(records):
            cluster_id = int(labels[index])
            cluster = cluster_by_id.get(cluster_id, {})
            neighbors, bridge_diversity = _neighbor_payload(similarity, labels, records, index)
            distinctiveness = float(distances_to_centroid[index] / max_distance)
            bridge_score = min(1.0, 0.35 * distinctiveness + 0.65 * bridge_diversity)
            x, y, z = [float(value) for value in normalized_coords[index, :3]]
            pc_values = [float(value) for value in pca_coords[index, : min(6, pca_coords.shape[1])]]
            era = record["era"]
            color = cluster.get("color", CLUSTER_COLORS[cluster_id % len(CLUSTER_COLORS)])
            image_url = record.get("image_url")

            meta = {
                "title": record["title"],
                "artist": record["artist"],
                "year": record["year"],
                "year_source": record["year_source"],
                "year_confidence": record["year_confidence"],
                "date_label": _date_label(record["year"], record["year_source"]),
                "style": record["style"],
                "genre": record["genre"],
                "thumbnail": image_url,
                "thumb": image_url,
                "era": era["label"],
                "tags": record["tags"],
            }

            f5 = {
                "projection": {
                    "x": round(x, 6),
                    "y": round(y, 6),
                    "z": round(z, 6),
                    "pc": [round(value, 6) for value in pc_values],
                    "method": "PCA",
                    "embedding_source": embedding_source,
                },
                "cluster": {
                    "id": cluster_id,
                    "label": cluster.get("label", f"Route {cluster_id + 1}"),
                    "color": color,
                    "distance": round(distinctiveness, 4),
                },
                "neighbors": neighbors,
                "scores": {
                    "bridge": round(float(bridge_score), 4),
                    "distinctiveness": round(float(distinctiveness), 4),
                },
                "axes": {
                    "planar_recession": round(x, 4),
                    "linear_painterly": round(y, 4),
                    "tonal_depth": round(z, 4),
                },
                "visual": visuals[index],
            }

            entry = {
                "id": record["id"],
                "file_id": record.get("file_id"),
                "path": record["path"],
                "filename": record["filename"],
                "image_url": image_url,
                "features": {
                    "pose": {"proj_x": round(x, 6), "proj_y": round(y, 6)},
                    "meta": meta,
                    "f5": f5,
                },
            }
            index_payload.append(entry)
            coords_payload.append(
                {
                    "id": record["id"],
                    "file_id": record.get("file_id"),
                    "path": record["path"],
                    "filename": record["filename"],
                    "x": round(x, 6),
                    "y": round(y, 6),
                    "z": round(z, 6),
                    "year": record["year"],
                    "year_source": record["year_source"],
                    "year_confidence": record["year_confidence"],
                    "date_label": meta["date_label"],
                    "style": record["style"],
                    "genre": record["genre"],
                    "label": record["title"],
                    "artist": record["artist"],
                    "thumb": image_url,
                    "image_url": image_url,
                    "cluster_id": cluster_id,
                    "cluster_label": cluster.get("label", f"Route {cluster_id + 1}"),
                    "cluster_color": color,
                    "era": era["label"],
                    "era_id": era["id"],
                    "neighbors": neighbors,
                    "bridge_score": round(float(bridge_score), 4),
                    "distinctiveness": round(float(distinctiveness), 4),
                    "visual": visuals[index],
                    "axes": f5["axes"],
                }
            )

        dated_years = [item["year"] for item in records if item["year"] is not None]
        exact_count = sum(1 for source in year_sources if source in EXACT_YEAR_SOURCES)
        estimated_count = sum(1 for source in year_sources if source in {"artist_lifetime", "model_estimate"})
        undated_count = len(records) - exact_count - estimated_count
        summary_payload = {
            "ok": True,
            "generated_at": _now_iso(),
            "records": len(index_payload),
            "embedding_source": embedding_source,
            "projection": {
                "method": "PCA",
                "explained_variance": [round(float(value), 5) for value in explained[:10]],
                "explained_variance_2d": round(float(explained[:2].sum()), 5),
                "explained_variance_3d": round(float(explained[:3].sum()), 5),
            },
            "years": {
                "min": int(min(dated_years)) if dated_years else None,
                "max": int(max(dated_years)) if dated_years else None,
                "known": int(exact_count),
                "estimated": int(estimated_count),
                "undated": int(undated_count),
                "year_head_available": bool(year_head_available is not None and year_head_available()),
                # The head's own input, kept separate from embedding_source
                # above: the map may run on the art fine-tune while the head
                # must not. Null means it was never run this pass.
                "year_head_input": "clip-base" if clip_matrix is not None else None,
                "model": year_head_metrics() if year_head_metrics is not None else None,
            },
            "clusters": cluster_summaries,
            "axes": [
                {
                    "id": "planar_recession",
                    "label": "Planar - Recession",
                    "description": "Horizontal spread, aligned with the first projection mode.",
                },
                {
                    "id": "linear_painterly",
                    "label": "Linear - Painterly",
                    "description": "Vertical spread, aligned with the second projection mode.",
                },
                {
                    "id": "tonal_depth",
                    "label": "Tonal depth",
                    "description": "Third projection mode used by the 3D table.",
                },
            ],
            "notes": [
                "Known dates are read from metadata, filenames and the WikiArt table.",
                "Remaining dates come from the trained year head and are marked as estimates.",
                "Works the year head cannot date stay undated - no date is invented from the style map.",
            ],
        }

        _write_state(
            state_file,
            pipeline_name,
            progress=88,
            stage="write",
            message="Writing the F5 map artifacts",
            can_use=False,
        )
        for file_name, payload in {
            "index.json": index_payload,
            "coords.json": coords_payload,
            "summary.json": summary_payload,
        }.items():
            with (output_dir / file_name).open("w", encoding="utf-8") as handle:
                json.dump(_json_safe(payload), handle, indent=2)

        _write_state(
            state_file,
            pipeline_name,
            progress=100,
            stage="ready",
            message="F5 history map is ready",
            status="completed",
            can_use=True,
            extra={"records": len(index_payload)},
        )
        logger.info("Wrote F5 artifacts to %s", output_dir)
        return True

    except Exception as exc:
        logger.error("Failed to generate history index: %s", exc, exc_info=True)
        _write_state(
            state_file,
            pipeline_name,
            progress=0,
            stage="failed",
            message=str(exc),
            status="failed",
            can_use=False,
            extra={"error": str(exc)},
        )
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Build F5 history map artifacts")
    parser.add_argument("image_root", type=Path, help="Root directory of images")
    parser.add_argument("output_dir", type=Path, help="Output directory for artifacts")
    parser.add_argument("--resume", action="store_true", help="Skip if index exists")
    parser.add_argument("--state-file", type=Path, default=None, help="Pipeline state JSON file")
    parser.add_argument("--pipeline-name", default="f5", help="Pipeline key inside state file")

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    if not args.image_root.exists():
        logger.error("image_root does not exist: %s", args.image_root)
        _write_state(
            args.state_file,
            args.pipeline_name,
            progress=0,
            stage="failed",
            message=f"Image root does not exist: {args.image_root}",
            status="failed",
            extra={"error": f"Image root does not exist: {args.image_root}"},
        )
        return 1

    index_file = args.output_dir / "index.json"
    if args.resume and index_file.exists():
        logger.info("index.json exists; skipping (--resume)")
        _write_state(
            args.state_file,
            args.pipeline_name,
            progress=100,
            stage="ready",
            message="F5 history map already exists",
            status="completed",
            can_use=True,
        )
        return 0

    success = generate_history_index(
        args.image_root,
        args.output_dir,
        state_file=args.state_file,
        pipeline_name=args.pipeline_name,
    )
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
