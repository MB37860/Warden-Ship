from __future__ import annotations

import json
import logging
from pathlib import Path

from flask import Blueprint, jsonify, request

from backend import paths

f6_api_bp = Blueprint("f6_api", __name__)

# Same resolution as the pipeline writer (see backend/paths.py) so reads
# and writes agree in both a checkout and a packaged build.
F6_OUTPUT_DIR = paths.f6_output_root()

logger = logging.getLogger(__name__)

FEATURE_FILES = {
    "poses": "poses.json",
    "colors": "colors.json",
    "hough": "hough.json",
    "portrait_poses": "portrait_poses.json",
    "index": "index.json",
}


def _refresh_index_if_stale(output_dir: Path) -> None:
    """Rebuild index.json when a feature file is newer than it.

    index.json is a merged snapshot of the six feature files, written once at the
    end of a full F6 run. Regenerate a single feature on its own - re-run one
    step, or swap in a corrected file - and the index keeps serving the old
    values with nothing to show that it is stale. The interface reads the index,
    so the app can silently display data that no longer exists on disk.
    """
    index_path = output_dir / FEATURE_FILES["index"]
    if not index_path.exists():
        return

    index_mtime = index_path.stat().st_mtime
    newer = [
        name
        for key, name in FEATURE_FILES.items()
        if key != "index"
        and (output_dir / name).exists()
        and (output_dir / name).stat().st_mtime > index_mtime
    ]
    if not newer:
        return

    try:
        from backend.f6_attributes.run_pipeline import build_unified_index

        build_unified_index(output_dir)
        logger.info("Rebuilt %s: %s changed since it was written", index_path, ", ".join(newer))
    except Exception:
        logger.warning("Could not rebuild stale %s", index_path, exc_info=True)


def _safe_output_name(value: str | None) -> str:
    name = (value or "default").strip() or "default"
    return "".join(char if char.isalnum() or char in {"-", "_"} else "_" for char in name)


def _request_db_name(payload: dict | None = None) -> str | None:
    raw = (
        request.args.get("db_name")
        or request.headers.get("X-DB-Name")
        or (payload or {}).get("db_name")
    )
    value = str(raw or "").strip()
    return value or None


def _output_dir_for_request(payload: dict | None = None) -> tuple[Path, str | None]:
    # A named database only ever reads its own scoped output. "default" used to
    # fall back to the legacy unscoped root, which served whichever collection
    # happened to be indexed there last - a 10-image database showed 110
    # paintings, most of them missing their image. Missing output now reports
    # missing, and the UI offers to run F6 for that database.
    db_name = _request_db_name(payload)
    if db_name:
        return F6_OUTPUT_DIR / _safe_output_name(db_name), db_name
    return F6_OUTPUT_DIR, None


def _read_json_count(path: Path) -> int:
    if not path.exists():
        return 0
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, list):
            return len(data)
        if isinstance(data, dict):
            return len(data)
        return 0
    except Exception:
        return 0
































@f6_api_bp.route("/health", methods=["GET"])
def health() -> tuple:
    output_dir, db_name = _output_dir_for_request()
    files = {}
    for key, file_name in FEATURE_FILES.items():
        path = output_dir / file_name
        files[key] = {
            "exists": path.exists(),
            "records": _read_json_count(path),
            "path": str(path),
        }

    ready_features = sum(1 for info in files.values() if info["exists"])
    return (
        jsonify(
            {
                "ok": True,
                "database": db_name,
                "output_dir": str(output_dir),
                "ready_features": ready_features,
                "total_features": len(FEATURE_FILES),
                "files": files,
            }
        ),
        200,
    )


@f6_api_bp.route("/summary", methods=["GET"])
def summary() -> tuple:
    output_dir, db_name = _output_dir_for_request()
    cards = []
    for key, file_name in FEATURE_FILES.items():
        path = output_dir / file_name
        cards.append(
            {
                "id": key,
                "label": key.replace("_", " ").title(),
                "file": file_name,
                "exists": path.exists(),
                "records": _read_json_count(path),
            }
        )

    return jsonify({"cards": cards, "database": db_name, "output_dir": str(output_dir)}), 200


@f6_api_bp.route("/index", methods=["GET"])
def index() -> tuple:
    """Return the unified index.json contents if present."""
    output_dir, db_name = _output_dir_for_request()
    _refresh_index_if_stale(output_dir)
    index_path = output_dir / FEATURE_FILES["index"]
    if not index_path.exists():
        return jsonify({"ok": False, "database": db_name, "error": "index.json not found"}), 404
    try:
        with index_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        return jsonify({"ok": True, "database": db_name, "index": data}), 200
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@f6_api_bp.route("/coords", methods=["GET"])
def coords() -> tuple:
    """Return a lightweight coords list for frontend mapping.

    Each entry: {id, x, y, year, label, thumb}
    Coordinates are extracted from available features (pose.proj_x/proj_y or pose clustering),
    fallback to None entries which frontend can ignore.
    """
    output_dir, db_name = _output_dir_for_request()
    index_path = output_dir / FEATURE_FILES["index"]
    if not index_path.exists():
        return jsonify({"ok": False, "database": db_name, "error": "index.json not found", "coords": []}), 200

    try:
        with index_path.open("r", encoding="utf-8") as handle:
            index_data = json.load(handle)

        coords = []
        for rec in index_data:
            img_id = rec.get("id")
            features = rec.get("features", {})
            x = y = None
            # try pose projection
            pose = features.get("pose") or {}
            if pose and isinstance(pose, dict):
                x = pose.get("proj_x")
                y = pose.get("proj_y")
            # try other feature projections if available
            if (x is None or y is None) and features.get("pose") and isinstance(features.get("pose"), list):
                # some modules store a list of pose records; skip
                pass

            # try to extract year and label/thumb
            year = None
            label = rec.get("id")
            thumb = None
            # guard: some records may have top-level path or metadata
            if rec.get("path"):
                label = rec.get("path")
            meta = features.get("meta") or {}
            if isinstance(meta, dict):
                year = meta.get("year")
                label = meta.get("title") or label
                thumb = meta.get("thumbnail") or meta.get("thumb")

            coords.append({"id": img_id, "x": x, "y": y, "year": year, "label": label, "thumb": thumb})

        return jsonify({"ok": True, "database": db_name, "coords": coords}), 200

    except Exception as e:
        return jsonify({"ok": False, "error": str(e), "coords": []}), 500
