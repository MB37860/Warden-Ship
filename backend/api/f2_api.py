from __future__ import annotations

import datetime as dt
import os
from typing import Any

from bson import ObjectId
from flask import Blueprint, jsonify, request
from gridfs import GridFS
from pymongo import MongoClient, ASCENDING

from backend.f2_classification import classify_image, get_runtime

f2_api_bp = Blueprint("f2_api", __name__)

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
MONGO_DB_PREFIX = os.getenv("MONGO_DB_PREFIX", "warden_ship")

client = MongoClient(MONGO_URI)


def _resolve_db_name() -> str:
    return (
        request.args.get("db_name")
        or request.form.get("db_name")
        or request.headers.get("X-DB-Name")
        or "default"
    )


def _get_database(db_name: str):
    full_db_name = f"{MONGO_DB_PREFIX}_{db_name}"
    db = client[full_db_name]

    fs = GridFS(db, collection="images")
    meta_collection = db["image_metadata"]
    meta_collection.create_index([("file_id", ASCENDING)], unique=True)

    return db, fs, meta_collection


def _json_safe(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dt.datetime):
        return value.isoformat() + "Z"
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


@f2_api_bp.route("/health", methods=["GET"])
def health() -> tuple:
    runtime = get_runtime()
    return (
        jsonify(
            {
                "ok": True,
                "model_available": runtime.available,
                "model_kind": runtime.model_kind,
                "model_path": str(runtime.model_path) if runtime.model_path else None,
                "labels_path": str(runtime.labels_path) if runtime.labels_path else None,
                "device": runtime.device,
                "labels": {
                    "styles": len(runtime.labels.get("styles", [])),
                    "genres": len(runtime.labels.get("genres", [])),
                    "artists": len(runtime.labels.get("artists", [])),
                },
                "message": runtime.last_error,
            }
        ),
        200,
    )


@f2_api_bp.route("/labels", methods=["GET"])
def labels() -> tuple:
    runtime = get_runtime()
    return (
        jsonify(
            {
                "ok": True,
                "labels": runtime.labels,
            }
        ),
        200,
    )


@f2_api_bp.route("/classify", methods=["POST"])
def classify() -> tuple:
    db_name = _resolve_db_name()
    db, fs, meta_collection = _get_database(db_name)

    image_file = request.files.get("image")
    file_id = (request.form.get("file_id") or request.args.get("file_id") or "").strip()
    hints: dict[str, Any] = {}

    if image_file is None and not file_id:
        return jsonify({"ok": False, "error": "image or file_id is required"}), 400

    image_bytes = None
    filename = None
    meta_doc = None

    if image_file is not None:
        image_bytes = image_file.read()
        filename = image_file.filename or "uploaded_image"
    else:
        try:
            oid = ObjectId(file_id)
        except Exception:
            return jsonify({"ok": False, "error": "Invalid file_id"}), 400

        try:
            grid_out = fs.get(oid)
        except Exception:
            return jsonify({"ok": False, "error": "Image not found"}), 404

        image_bytes = grid_out.read()
        filename = getattr(grid_out, "filename", None)
        meta_doc = meta_collection.find_one({"file_id": oid})

    if meta_doc and isinstance(meta_doc.get("metadata"), dict):
        hints.update(meta_doc["metadata"])
    if meta_doc and isinstance(meta_doc.get("tags"), list):
        hints.setdefault("tags", meta_doc.get("tags"))

    try:
        top_k = int(request.form.get("top_k") or request.args.get("top_k") or 5)
    except (TypeError, ValueError):
        top_k = 5

    prediction = classify_image(image_bytes, top_k=top_k, hints=hints)

    return (
        jsonify(
            {
                "ok": True,
                "source": prediction.get("source"),
                "model_available": prediction.get("model_available"),
                "elapsed_ms": prediction.get("elapsed_ms"),
                "style": prediction.get("style"),
                "genre": prediction.get("genre"),
                "artist": prediction.get("artist"),
                "input": {
                    "file_id": file_id or (str(meta_doc.get("file_id")) if meta_doc else None),
                    "filename": filename,
                    "db_name": db_name,
                    "metadata": _json_safe(meta_doc.get("metadata")) if meta_doc else None,
                },
            }
        ),
        200,
    )
