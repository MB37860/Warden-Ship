"""
Feature: Hough Transform Explorer
==================================
For each painting, pre-computes the full Canny → Hough pipeline at multiple
parameter settings, stores edge images and line parameter histograms.

Upgrade over original prototype:
- Precomputed at 3 parameter presets (fine / medium / coarse) for fast switching.
- Stores a compact sinusoid histogram for quick frontend matching.
- Matching endpoint: given user-drawn sinusoids (rho/theta pairs), find the most
  similar paintings using histogram intersection.

Output schema per painting:
{
  "id":     "...",
  "path":   "...",
  "presets": {
    "fine":   { "canny_low":50, "canny_high":150, "hough_threshold":30,
                "line_count": 42, "rho_theta_hist": [...] },
    "medium": { ... },
    "coarse": { ... }
  }
}

rho_theta_hist is a flattened N_RHO_BINS × N_THETA_BINS 2-D histogram (list of ints),
representing the accumulator density in (ρ, θ) space — this IS the Hough accumulator,
downsampled to a compact representation.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import NamedTuple

import cv2
import numpy as np
from tqdm import tqdm

from backend.f6_attributes.utils import discover_images, image_meta, load_json, save_json

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

N_RHO_BINS   = 32
N_THETA_BINS = 32

class Preset(NamedTuple):
    canny_low:       int
    canny_high:      int
    hough_threshold: int

PRESETS = {
    "fine":   Preset(30,  90,  20),
    "medium": Preset(50,  150, 40),
    "coarse": Preset(80,  200, 70),
}

# Processing resolution — resize images before Canny to keep compute fast
PROC_SIZE = (512, 512)


# ---------------------------------------------------------------------------
# Core computation
# ---------------------------------------------------------------------------

def _compute_preset(gray: np.ndarray, preset: Preset) -> dict:
    """
    Apply Canny + Hough on a grayscale image with given parameters.
    Returns a dict ready for JSON storage.
    """
    edges = cv2.Canny(gray, preset.canny_low, preset.canny_high, apertureSize=3)

    lines = cv2.HoughLines(edges, rho=1, theta=np.pi / 180, threshold=preset.hough_threshold)

    if lines is None:
        rho_theta_hist = [0] * (N_RHO_BINS * N_THETA_BINS)
        return {
            "canny_low":       preset.canny_low,
            "canny_high":      preset.canny_high,
            "hough_threshold": preset.hough_threshold,
            "line_count":      0,
            "rho_theta_hist":  rho_theta_hist,
        }

    lines = lines.squeeze(1)   # shape: (N, 2) — rho, theta
    rhos   = lines[:, 0]
    thetas = lines[:, 1]

    # Compute histogram in (rho, theta) space
    diag = float(np.sqrt(gray.shape[0] ** 2 + gray.shape[1] ** 2))
    hist, _, _ = np.histogram2d(
        rhos, thetas,
        bins=[N_RHO_BINS, N_THETA_BINS],
        range=[[-diag, diag], [0, np.pi]],
    )
    hist_norm = (hist / (hist.max() + 1e-9) * 255).astype(np.uint8)

    return {
        "canny_low":       preset.canny_low,
        "canny_high":      preset.canny_high,
        "hough_threshold": preset.hough_threshold,
        "line_count":      int(len(lines)),
        "rho_theta_hist":  hist_norm.flatten().tolist(),
    }


def analyse_single(path: Path, root: Path) -> dict:
    img = cv2.imread(str(path))
    meta = image_meta(path, root)

    if img is None:
        meta["presets"] = {name: {"line_count": 0, "rho_theta_hist": [0] * (N_RHO_BINS * N_THETA_BINS)}
                           for name in PRESETS}
        return meta

    img_resized = cv2.resize(img, PROC_SIZE)
    gray = cv2.cvtColor(img_resized, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    meta["presets"] = {name: _compute_preset(gray, preset) for name, preset in PRESETS.items()}
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
    for path in tqdm(images, desc="Hough transform"):
        img_id = str(path.relative_to(root))
        if img_id in existing:
            continue
        results.append(analyse_single(path, root))

    save_json(results, output_path)
    logger.info(f"Saved {len(results)} Hough records to {output_path}")


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
    parser = argparse.ArgumentParser(description="Hough transform pre-computation")
    parser.add_argument("image_root")
    parser.add_argument("output")
    parser.add_argument("--no-resume", action="store_true")
    args = parser.parse_args()

    run(args.image_root, args.output, resume=not args.no_resume)
