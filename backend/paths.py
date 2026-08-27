"""Filesystem locations the backend is allowed to write to.

In a packaged desktop build the backend source lives inside a read-only app
bundle (AppImage squashfs, macOS .app, Program Files), so pipeline state and
feature output cannot sit next to the code the way they do in a checkout.
Electron points ``WARDEN_SHIP_DATA_DIR`` at a per-user writable directory; when
it is unset the paths collapse back to the backend directory, which is exactly
what a dev checkout used before.
"""

from __future__ import annotations

import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent

DATA_ROOT = Path(os.getenv("WARDEN_SHIP_DATA_DIR", str(BACKEND_ROOT)))

# Progress/state shared between the Flask process and pipeline subprocesses.
PIPELINE_STATE_FILE = DATA_ROOT / ".pipeline_state.json"

# Scratch cwd for pipeline subprocesses: libraries such as ultralytics download
# weights into the current directory, which must therefore not be the bundle.
WORK_DIR = DATA_ROOT / "work"


def f5_output_root() -> Path:
    """Directory holding F5 history-map artefacts (one subdir per database)."""
    return Path(os.getenv("F5_OUTPUT_DIR", str(DATA_ROOT / "f5_history_map" / "output")))


def f6_output_root() -> Path:
    """Directory holding F6 attribute artefacts (one subdir per database)."""
    return Path(os.getenv("F6_OUTPUT_DIR", str(DATA_ROOT / "f6_attributes" / "output")))


def ensure_writable_dirs() -> None:
    """Create the writable tree; safe to call repeatedly."""
    for directory in (DATA_ROOT, WORK_DIR, f5_output_root(), f6_output_root()):
        directory.mkdir(parents=True, exist_ok=True)
