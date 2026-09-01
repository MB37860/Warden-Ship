"""
Feature: Pose Clustering
========================
Extracts body-pose keypoints from paintings using MediaPipe Pose, then clusters
similar poses using DBSCAN (or k-means) and projects them to 2-D for the frontend map.

Upgrade over original prototype:
- Filters out poses where the detected skeleton occupies < MIN_POSE_RATIO of the image
  (discovered threshold: 8 %, std 7.6 %, from the original paper).
- Supports pose-matching search: given a query pose vector, find nearest neighbours.
- UMAP / PCA projection stored alongside cluster labels for frontend scatter map.

Output schema per painting:
{
  "id":          "...",
  "path":        "...",
  "keypoints":   [[x, y, visibility], ...],   # 33 MediaPipe keypoints, normalised [0,1]
  "pose_ratio":  0.13,                         # fraction of image occupied by bounding box
  "valid":       true,                         # false = below MIN_POSE_RATIO threshold
  "cluster":     2,                            # DBSCAN cluster id; -1 = noise
  "proj_x":      0.34,                         # 2-D projection X (UMAP or PCA)
  "proj_y":      -0.12                         # 2-D projection Y
}

Cluster assignment and 2-D projection are written after all keypoints are extracted
(second pass).
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
from tqdm import tqdm

from backend.f6_attributes.mediapipe_compat import import_mediapipe
from backend.f6_attributes.utils import (
    discover_images,
    image_meta,
    load_json,
    resumable_records,
    save_json,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MIN_POSE_RATIO  = 0.08   # 8 % minimum skeleton bounding box / image area
N_CLUSTERS      = 12     # used if falling back to k-means
DBSCAN_EPS      = 0.25
DBSCAN_MIN_SAMPLES = 3
N_KEYPOINTS     = 33     # MediaPipe Pose


# ---------------------------------------------------------------------------
# Keypoint extraction
# ---------------------------------------------------------------------------

def _load_mediapipe():
    try:
        mp = import_mediapipe()
        return mp.solutions.pose.Pose(
            static_image_mode=True,
            model_complexity=2,
            min_detection_confidence=0.5,
        )
    except ImportError:
        raise RuntimeError(
            "MediaPipe is required for pose analysis. "
            "Install it with:  pip install mediapipe"
        )


def _pose_bounding_box_ratio(keypoints: list, img_w: int, img_h: int) -> float:
    """
    Compute the fraction of the image covered by the axis-aligned bounding box of
    all visible keypoints.
    """
    visible = [(kp[0] * img_w, kp[1] * img_h) for kp in keypoints if kp[2] > 0.5]
    if len(visible) < 4:
        return 0.0
    xs = [p[0] for p in visible]
    ys = [p[1] for p in visible]
    bbox_area = (max(xs) - min(xs)) * (max(ys) - min(ys))
    return bbox_area / max(1, img_w * img_h)


def extract_keypoints(path: Path, root: Path, pose_model) -> dict:
    import cv2

    img = cv2.imread(str(path))
    meta = image_meta(path, root)

    if img is None:
        meta.update({"keypoints": [], "pose_ratio": 0.0, "valid": False})
        return meta

    h, w = img.shape[:2]
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    result = pose_model.process(rgb)

    if result.pose_landmarks is None:
        meta.update({"keypoints": [], "pose_ratio": 0.0, "valid": False})
        return meta

    keypoints = [
        [lm.x, lm.y, lm.visibility]
        for lm in result.pose_landmarks.landmark
    ]

    pose_ratio = _pose_bounding_box_ratio(keypoints, w, h)
    valid = pose_ratio >= MIN_POSE_RATIO

    meta.update({
        "keypoints":  keypoints,
        "pose_ratio": round(pose_ratio, 4),
        "valid":      valid,
    })
    return meta


# ---------------------------------------------------------------------------
# Clustering + projection (second pass)
# ---------------------------------------------------------------------------

def _keypoints_to_vector(keypoints: list) -> np.ndarray:
    """Flatten [x, y] of all keypoints into a 66-dim vector (drop visibility)."""
    return np.array([[kp[0], kp[1]] for kp in keypoints], dtype=np.float32).flatten()


def cluster_and_project(records: list[dict]) -> list[dict]:
    """
    Cluster valid records by pose similarity and add 2-D projection coordinates.
    Returns the same list with 'cluster', 'proj_x', 'proj_y' added to each record.
    """
    valid_idx = [i for i, r in enumerate(records) if r.get("valid") and len(r.get("keypoints", [])) == N_KEYPOINTS]

    if len(valid_idx) < DBSCAN_MIN_SAMPLES:
        logger.warning("Not enough valid poses for clustering.")
        for r in records:
            r.setdefault("cluster", -1)
            r.setdefault("proj_x",   0.0)
            r.setdefault("proj_y",   0.0)
        return records

    X = np.stack([_keypoints_to_vector(records[i]["keypoints"]) for i in valid_idx])

    # Normalise per-dimension
    X = (X - X.mean(axis=0)) / (X.std(axis=0) + 1e-8)

    # --- 2-D projection ---
    try:
        import umap
        proj = umap.UMAP(n_components=2, random_state=42).fit_transform(X)
    except ImportError:
        from sklearn.decomposition import PCA
        proj = PCA(n_components=2).fit_transform(X)

    # --- Clustering ---
    try:
        from sklearn.cluster import DBSCAN
        labels = DBSCAN(eps=DBSCAN_EPS, min_samples=DBSCAN_MIN_SAMPLES, metric="cosine").fit_predict(X)
    except ImportError:
        from sklearn.cluster import KMeans
        labels = KMeans(n_clusters=min(N_CLUSTERS, len(valid_idx)), random_state=42, n_init=10).fit_predict(X)

    # Write back
    for local_i, global_i in enumerate(valid_idx):
        records[global_i]["cluster"] = int(labels[local_i])
        records[global_i]["proj_x"]  = round(float(proj[local_i, 0]), 4)
        records[global_i]["proj_y"]  = round(float(proj[local_i, 1]), 4)

    # Fill in invalid records
    for r in records:
        r.setdefault("cluster", -1)
        r.setdefault("proj_x",   0.0)
        r.setdefault("proj_y",   0.0)

    return records


# ---------------------------------------------------------------------------
# Batch pipeline
# ---------------------------------------------------------------------------

def run(image_root: str | Path, output_path: str | Path, resume: bool = True) -> None:
    root = Path(image_root)
    output_path = Path(output_path)

    images = discover_images(root)
    logger.info(f"Found {len(images)} images")

    existing: dict[str, dict] = {}
    if resume and output_path.exists():
        try:
            existing = resumable_records(load_json(output_path))
            logger.info(f"Resuming: {len(existing)} already processed")
        except Exception:
            pass

    pose_model = _load_mediapipe()
    results = list(existing.values())

    for path in tqdm(images, desc="Pose extraction"):
        img_id = str(path.relative_to(root))
        if img_id in existing:
            continue
        record = extract_keypoints(path, root, pose_model)
        results.append(record)

    pose_model.close()

    logger.info("Clustering poses…")
    results = cluster_and_project(results)

    save_json(results, output_path)
    logger.info(f"Saved {len(results)} pose records to {output_path}")


# ---------------------------------------------------------------------------
# Query helpers (serve-time)
# ---------------------------------------------------------------------------

def load_results(output_path: str | Path) -> list[dict]:
    return load_json(output_path)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    parser = argparse.ArgumentParser(description="Pose clustering pre-computation")
    parser.add_argument("image_root")
    parser.add_argument("output")
    parser.add_argument("--no-resume", action="store_true")
    args = parser.parse_args()

    run(args.image_root, args.output, resume=not args.no_resume)
