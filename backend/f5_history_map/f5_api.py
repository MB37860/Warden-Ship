from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from flask import Blueprint, jsonify, request

from backend import paths

f5_api_bp = Blueprint("f5_api", __name__)

# Same resolution as the pipeline writer (see backend/paths.py) so reads
# and writes agree in both a checkout and a packaged build.
F5_OUTPUT_DIR = paths.f5_output_root()

FEATURE_FILES = {
    "index": "index.json",
    "coords": "coords.json",
    "summary": "summary.json",
}


def _safe_db_name(db_name: str | None) -> str:
    value = (db_name or "default").strip() or "default"
    return "".join(char if char.isalnum() or char in {"-", "_"} else "_" for char in value)


def _output_dir_for_request() -> Path:
    db_name = request.args.get("db_name")
    if not db_name:
        return F5_OUTPUT_DIR

    return F5_OUTPUT_DIR / _safe_db_name(db_name)


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return fallback


def _read_json_count(path: Path) -> int:
    data = _read_json(path, fallback=None)
    if isinstance(data, list):
        return len(data)
    if isinstance(data, dict):
        if isinstance(data.get("records"), int):
            return int(data["records"])
        return len(data)
    return 0


def _coords_from_index(index_data: list[dict[str, Any]]) -> list[dict[str, Any]]:
    coords = []
    for rec in index_data:
        img_id = rec.get("id")
        features = rec.get("features", {})
        f5 = features.get("f5") if isinstance(features.get("f5"), dict) else {}
        projection = f5.get("projection") if isinstance(f5.get("projection"), dict) else {}
        cluster = f5.get("cluster") if isinstance(f5.get("cluster"), dict) else {}
        meta = features.get("meta") if isinstance(features.get("meta"), dict) else {}
        pose = features.get("pose") if isinstance(features.get("pose"), dict) else {}

        x = projection.get("x", pose.get("proj_x"))
        y = projection.get("y", pose.get("proj_y"))
        z = projection.get("z", 0)

        coords.append(
            {
                "id": img_id,
                "file_id": rec.get("file_id"),
                "path": rec.get("path"),
                "filename": rec.get("filename"),
                "x": x,
                "y": y,
                "z": z,
                "year": meta.get("year"),
                "year_source": meta.get("year_source"),
                "year_confidence": meta.get("year_confidence"),
                "date_label": meta.get("date_label"),
                "style": meta.get("style"),
                "genre": meta.get("genre"),
                "label": meta.get("title") or rec.get("filename") or img_id,
                "artist": meta.get("artist"),
                "thumb": meta.get("thumbnail") or meta.get("thumb") or rec.get("image_url"),
                "image_url": rec.get("image_url"),
                "cluster_id": cluster.get("id"),
                "cluster_label": cluster.get("label"),
                "cluster_color": cluster.get("color"),
                "era": meta.get("era"),
                "neighbors": f5.get("neighbors", []),
                "bridge_score": (f5.get("scores") or {}).get("bridge"),
                "distinctiveness": (f5.get("scores") or {}).get("distinctiveness"),
                "visual": f5.get("visual", {}),
                "axes": f5.get("axes", {}),
            }
        )
    return coords


@f5_api_bp.route("/health", methods=["GET"])
def health() -> tuple:
    output_dir = _output_dir_for_request()
    files = {}
    for key, file_name in FEATURE_FILES.items():
        path = output_dir / file_name
        files[key] = {
            "exists": path.exists(),
            "records": _read_json_count(path),
            "path": str(path),
        }

    ready_features = sum(1 for info in files.values() if info["exists"])
    summary_payload = _read_json(output_dir / "summary.json", fallback={})
    return (
        jsonify(
            {
                "ok": True,
                "output_dir": str(output_dir),
                "ready_features": ready_features,
                "total_features": len(FEATURE_FILES),
                "records": summary_payload.get("records", files["index"]["records"]),
                "embedding_source": summary_payload.get("embedding_source"),
                "year_range": summary_payload.get("years"),
                "files": files,
            }
        ),
        200,
    )


@f5_api_bp.route("/summary", methods=["GET"])
def summary() -> tuple:
    output_dir = _output_dir_for_request()
    summary_path = output_dir / FEATURE_FILES["summary"]
    summary_payload = _read_json(summary_path, fallback={})
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

    return (
        jsonify(
            {
                "ok": True,
                "cards": cards,
                "output_dir": str(output_dir),
                "summary": summary_payload,
            }
        ),
        200,
    )


@f5_api_bp.route("/index", methods=["GET"])
def index() -> tuple:
    output_dir = _output_dir_for_request()
    index_path = output_dir / FEATURE_FILES["index"]
    if not index_path.exists():
        return jsonify({"ok": False, "error": "index.json not found"}), 404
    data = _read_json(index_path, fallback=None)
    if data is None:
        return jsonify({"ok": False, "error": "Could not read index.json"}), 500
    return jsonify({"ok": True, "index": data}), 200


@f5_api_bp.route("/coords", methods=["GET"])
def coords() -> tuple:
    output_dir = _output_dir_for_request()
    coords_path = output_dir / FEATURE_FILES["coords"]
    # The year block travels with the coords so the chart can state how the
    # dates were obtained without a second request.
    years = (_read_json(output_dir / FEATURE_FILES["summary"], fallback={}) or {}).get("years")
    if coords_path.exists():
        data = _read_json(coords_path, fallback=[])
        return jsonify({"ok": True, "coords": data if isinstance(data, list) else [], "years": years}), 200

    index_path = output_dir / FEATURE_FILES["index"]
    if not index_path.exists():
        return jsonify({"ok": False, "error": "index.json not found", "coords": []}), 200

    index_data = _read_json(index_path, fallback=[])
    if not isinstance(index_data, list):
        return jsonify({"ok": False, "error": "index.json is not a list", "coords": []}), 500

    return jsonify({"ok": True, "coords": _coords_from_index(index_data), "years": years}), 200
