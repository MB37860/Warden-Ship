"""
Feature: HSL Color Navigation
==============================
For each painting, computes:
  1. Dominant color (via k-means on pixel samples) — upgrade over simple average.
  2. Full HSL histogram (16 bins each for H, S, L).
  3. Dominant color palette (top-k k-means cluster centres).
  4. Grid position in the 16×16 (lightness × saturation) matrix.

Upgrade over original prototype:
- Uses dominant color via k-means instead of naive pixel average.
- Extracts a full colour palette (multiple dominant colours).
- Histogram stored as compact int16 arrays for fast serve-time comparison.

Output schema per painting:
{
  "id":              "...",
  "path":            "...",
  "dominant_hsl":    [h_norm, s_norm, l_norm],   # dominant colour in HSL [0,1]
  "grid_x":          9,    # saturation cell (0-15)
  "grid_y":          6,    # lightness cell  (0-15)
  "palette_hsl":     [[h,s,l], ...],              # top-5 palette entries, normalised
  "palette_weights": [0.41, 0.22, ...],           # share of sampled pixels per palette entry
  "hist_h":          [...],  # 16-bin hue histogram (counts)
  "hist_s":          [...],  # 16-bin saturation histogram
  "hist_l":          [...],  # 16-bin lightness histogram
}
"""

from __future__ import annotations

import logging
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm

from backend.f6_attributes.utils import discover_images, image_meta, load_json, save_json

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PALETTE_K       = 5     # dominant palette colours
HIST_BINS       = 16    # grid resolution (matches frontend 16×16 grid)
SAMPLE_PIXELS   = 2000  # random pixel sample for k-means (performance)
KMEANS_ATTEMPTS = 3


# ---------------------------------------------------------------------------
# Core computation
# ---------------------------------------------------------------------------

def _bgr_to_hls_pixels(img_bgr: np.ndarray) -> np.ndarray:
    """Return (N, 3) float32 array of HLS pixels sampled from the image."""
    hls = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HLS).astype(np.float32)
    # OpenCV HLS: H in [0,180], L and S in [0,255]
    h, w = img_bgr.shape[:2]
    pixels = hls.reshape(-1, 3)
    if len(pixels) > SAMPLE_PIXELS:
        idx = np.random.choice(len(pixels), SAMPLE_PIXELS, replace=False)
        pixels = pixels[idx]
    # Normalise to [0, 1]
    pixels[:, 0] /= 180.0  # H
    pixels[:, 1] /= 255.0  # L
    pixels[:, 2] /= 255.0  # S
    return pixels  # (N, 3) — order: H, L, S


def _dominant_colors_kmeans(pixels: np.ndarray, k: int = PALETTE_K):
    """
    Run k-means on HLS pixel sample.
    Returns (cluster_centres, cluster_sizes) sorted by cluster size descending.
    centres shape: (k, 3) in normalised HLS [0,1].
    """
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.01)
    pixels_f32 = pixels.astype(np.float32)
    k = min(k, len(pixels_f32))
    _, labels, centres = cv2.kmeans(
        pixels_f32, k, None, criteria, KMEANS_ATTEMPTS, cv2.KMEANS_RANDOM_CENTERS
    )
    labels = labels.flatten()
    sizes = np.bincount(labels, minlength=k)
    order = np.argsort(sizes)[::-1]
    return centres[order], sizes[order]


def _hsl_histograms(pixels: np.ndarray, bins: int = HIST_BINS):
    """Compute per-channel histograms. Returns three lists of length *bins*."""
    hist_h = np.histogram(pixels[:, 0], bins=bins, range=(0, 1))[0].tolist()
    hist_l = np.histogram(pixels[:, 1], bins=bins, range=(0, 1))[0].tolist()
    hist_s = np.histogram(pixels[:, 2], bins=bins, range=(0, 1))[0].tolist()
    return hist_h, hist_s, hist_l


def analyse_single(path: Path, root: Path) -> dict:
    img = cv2.imread(str(path))
    meta = image_meta(path, root)

    if img is None:
        meta.update({
            "dominant_hsl": [0.0, 0.0, 0.0],
            "grid_x":       0,
            "grid_y":       0,
            "palette_hsl":  [],
            "palette_weights": [],
            "hist_h":       [0] * HIST_BINS,
            "hist_s":       [0] * HIST_BINS,
            "hist_l":       [0] * HIST_BINS,
        })
        return meta

    pixels = _bgr_to_hls_pixels(img)  # (N, 3): H, L, S normalised
    centres, sizes = _dominant_colors_kmeans(pixels)
    hist_h, hist_s, hist_l = _hsl_histograms(pixels)

    dominant = centres[0]  # [H, L, S] normalised — most frequent cluster
    # Reorder to H, S, L for storage consistency
    dominant_hsl = [round(float(dominant[0]), 4),  # H
                    round(float(dominant[2]), 4),  # S
                    round(float(dominant[1]), 4)]  # L

    palette_hsl = [
        [round(float(c[0]), 4), round(float(c[2]), 4), round(float(c[1]), 4)]
        for c in centres
    ]

    # k-means always returns PALETTE_K centres, so the palette lists a colour
    # covering two percent of the canvas beside one covering half of it. The
    # interface needs to tell those apart — a filter that treats every centre
    # alike hands back the same paintings for neighbouring dyes — and cluster
    # size is the only thing that separates them.
    total = float(sizes.sum()) or 1.0
    palette_weights = [round(float(size) / total, 4) for size in sizes]

    # Grid position: X = saturation cell, Y = lightness cell
    grid_x = min(int(dominant_hsl[1] * HIST_BINS), HIST_BINS - 1)
    grid_y = min(int(dominant_hsl[2] * HIST_BINS), HIST_BINS - 1)

    meta.update({
        "dominant_hsl": dominant_hsl,
        "grid_x":       grid_x,
        "grid_y":       grid_y,
        "palette_hsl":  palette_hsl,
        "palette_weights": palette_weights,
        "hist_h":       hist_h,
        "hist_s":       hist_s,
        "hist_l":       hist_l,
    })
    return meta


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
            existing = {r["id"]: r for r in load_json(output_path)}
            logger.info(f"Resuming: {len(existing)} already processed")
        except Exception:
            pass

    results = list(existing.values())
    for path in tqdm(images, desc="HSL color analysis"):
        img_id = str(path.relative_to(root))
        if img_id in existing:
            continue
        results.append(analyse_single(path, root))

    save_json(results, output_path)
    logger.info(f"Saved {len(results)} color records to {output_path}")


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
    parser = argparse.ArgumentParser(description="HSL color pre-computation")
    parser.add_argument("image_root")
    parser.add_argument("output")
    parser.add_argument("--no-resume", action="store_true")
    args = parser.parse_args()

    run(args.image_root, args.output, resume=not args.no_resume)
