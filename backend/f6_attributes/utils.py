"""
Shared utilities for the painting CV pipeline.
"""

import json
import logging
from pathlib import Path
from typing import Any


logger = logging.getLogger(__name__)


def save_json(data: Any, path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_json(path: str | Path) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def discover_images(root: str | Path, extensions=(".jpg", ".jpeg", ".png", ".webp")) -> list[Path]:
    """Recursively discover all images under *root*."""
    root = Path(root)
    images = []
    for ext in extensions:
        images.extend(root.rglob(f"*{ext}"))
        images.extend(root.rglob(f"*{ext.upper()}"))
    return sorted(set(images))


# ---------------------------------------------------------------------------
# Image metadata
# ---------------------------------------------------------------------------

# Backends that mean "nothing was actually measured here". A record carrying one
# is a placeholder, not a result.
FALLBACK_BACKENDS = {"unavailable", "template-fallback"}


def resumable_records(records: list[dict]) -> dict[str, dict]:
    """Previously computed results worth keeping, keyed by image id.

    Resume exists to avoid re-running a detector over images it already did.
    Placeholders written by a fallback are not results, and keeping them freezes
    the channel forever: one failed run writes a placeholder for every painting,
    every later run skips every id it finds, and the detector never gets another
    attempt even once the underlying problem is fixed.
    """
    return {
        record["id"]: record
        for record in records
        if record.get("backend") not in FALLBACK_BACKENDS
    }


def image_meta(path: Path, root: Path) -> dict:
    """Return lightweight metadata dict for a painting."""
    return {
        "id": str(path.relative_to(root)),
        "path": str(path),
        "filename": path.name,
    }
