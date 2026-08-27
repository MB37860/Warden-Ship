"""Runtime loader for the trained F5 year-estimation head.

The head is a small TorchScript MLP trained on WikiArt CLIP embeddings
(see backend/training/f5_year_head/train_year_head.py): (N, 512) L2-normalized CLIP image vectors
-> (predicted years, confidence in [0, 1]). Loading is lazy and every failure
degrades to None, in which case the work stays undated - the pipeline never
invents a year.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np

try:
    import torch
except Exception:  # pragma: no cover - torch is optional for fallback
    torch = None

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_MODEL_PATH = _REPO_ROOT / "data" / "f5_year_head" / "f5_year_head.pt"

_MODEL = None
_MODEL_FAILED = False


def _model_path() -> Path:
    value = os.getenv("F5_YEAR_MODEL_PATH", "").strip()
    return Path(value).expanduser() if value else _DEFAULT_MODEL_PATH


def year_head_available() -> bool:
    return torch is not None and not _MODEL_FAILED and _model_path().exists()


def year_head_metrics() -> dict | None:
    """Held-out accuracy of the shipped head, written by train_year_head.py.

    This is the honest uncertainty to put next to an estimated date. The
    per-artwork confidence the model returns is the peak of a 73-bin softmax
    over Gaussian-smoothed targets, so it cannot be read as a percentage.
    """
    path = _model_path().with_name("f5_year_head_metrics.json")
    if not path.exists():
        return None
    try:
        with path.open(encoding="utf-8") as handle:
            metrics = json.load(handle)
    except Exception:
        return None
    test = metrics.get("test") or {}
    bins = metrics.get("bins") or {}
    return {
        "mae": test.get("mae"),
        "within_50y": test.get("within_50y"),
        "n_bins": bins.get("n_bins"),
        "bin_years": bins.get("bin_years"),
    }


def predict_years_from_clip(clip_vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    """Predict creation years from CLIP image embeddings.

    Returns (years, confidence) as float arrays, or None when the model or
    torch is unavailable or the input does not match the trained head.
    """
    global _MODEL, _MODEL_FAILED
    if torch is None or _MODEL_FAILED:
        return None
    if _MODEL is None:
        path = _model_path()
        if not path.exists():
            return None
        try:
            _MODEL = torch.jit.load(str(path), map_location="cpu")
            _MODEL.eval()
        except Exception:
            _MODEL_FAILED = True
            return None
    try:
        batch = torch.from_numpy(np.asarray(clip_vectors, dtype=np.float32))
        with torch.inference_mode():
            years, confidence = _MODEL(batch)
        return years.numpy().astype(np.float64), confidence.numpy().astype(np.float64)
    except Exception:
        return None
