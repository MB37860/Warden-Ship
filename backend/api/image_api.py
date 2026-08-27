from __future__ import annotations

import datetime as dt
import json
import os
import time

import numpy as np
from bson import ObjectId
from flask import Blueprint, jsonify, request, send_file
from gridfs import GridFS
from pymongo import ASCENDING, MongoClient

from backend.api.clip_service import (
    clip_available,
    clip_error,
    clip_model_tag,
    embed_images,
    embed_text,
)

image_api_bp = Blueprint("image_api", __name__)

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
MONGO_DB_PREFIX = os.getenv("MONGO_DB_PREFIX", "warden_ship")

client = MongoClient(MONGO_URI)
_EMBEDDING_INDEX_TTL_SECONDS = 10
_embedding_index_cache: dict[str, dict] = {}


def _get_database(db_name: str | None = None):
    """Get database instance by name. Returns both db and collections."""
    if db_name is None:
        db_name = request.args.get("db_name") or request.headers.get("X-DB-Name") or "default"

    full_db_name = f"{MONGO_DB_PREFIX}_{db_name}"
    db = client[full_db_name]

    # Ensure collections exist with proper indexes
    fs = GridFS(db, collection="images")
    meta_collection = db["image_metadata"]
    meta_collection.create_index([("file_id", ASCENDING)], unique=True)
    meta_collection.create_index([("filename", ASCENDING)])

    return db, fs, meta_collection, db_name


def _to_object_id(value: str) -> ObjectId:
    return ObjectId(value)


def _safe_json_load(raw: str | None, fallback: object) -> object:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return fallback


def _json_safe(value):
    """Convert Mongo/Python values into data Flask can always JSON encode."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dt.datetime):
        return value.isoformat() + "Z"
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


def _invalidate_embedding_index(db_name: str) -> None:
    _embedding_index_cache.pop(db_name, None)


def _embedding_index(meta_collection, db_name: str) -> dict:
    cached = _embedding_index_cache.get(db_name)
    now = time.monotonic()
    if cached and now - cached["loaded_at"] < _EMBEDDING_INDEX_TTL_SECONDS:
        return cached

    docs = list(
        meta_collection.find(
            {"embedding": {"$type": "array", "$ne": []}},
            {
                "file_id": 1,
                "filename": 1,
                "content_type": 1,
                "size_bytes": 1,
                "tags": 1,
                "metadata": 1,
                "features": 1,
                "created_at": 1,
                "embedding": 1,
            },
        )
    )
    vectors = []
    indexed_docs = []
    expected_dim = None
    for doc in docs:
        vector = np.asarray(doc.get("embedding"), dtype=np.float32)
        if vector.ndim != 1 or vector.size == 0:
            continue
        if expected_dim is None:
            expected_dim = vector.size
        if vector.size != expected_dim:
            continue
        vectors.append(vector)
        indexed_docs.append(doc)

    matrix = np.vstack(vectors).astype(np.float32) if vectors else np.empty((0, 0), dtype=np.float32)
    payload = {
        "loaded_at": now,
        "docs": indexed_docs,
        "matrix": matrix,
    }
    _embedding_index_cache[db_name] = payload
    return payload


def _fallback_match_score(document: dict, query: str) -> float:
    tokens = [token for token in query.lower().split() if token]
    if not tokens:
        return 0.0

    filename = str(document.get("filename", "")).lower()
    tags = [str(tag).lower() for tag in document.get("tags", [])]
    metadata = document.get("metadata", {})
    caption = str(metadata.get("caption", "")).lower()
    search_blob = " ".join([filename, caption, " ".join(tags)])

    score = 0.0
    for token in tokens:
        if token in search_blob:
            score += 1.0
    return score / len(tokens)


def _serialize_document(
    document: dict,
    similarity: float | None = None,
    db_name: str | None = None,
) -> dict:
    image_url = f"/api/image/image/{document['file_id']}"
    if db_name:
        image_url = f"{image_url}?db_name={db_name}"

    payload = {
        "id": str(document["_id"]),
        "file_id": str(document["file_id"]),
        "filename": document.get("filename"),
        "content_type": document.get("content_type"),
        "size_bytes": document.get("size_bytes"),
        "tags": _json_safe(document.get("tags", [])),
        "metadata": _json_safe(document.get("metadata", {})),
        "features": _json_safe(document.get("features", {})),
        "created_at": _json_safe(document.get("created_at")),
        "image_url": image_url,
        "has_embedding": bool(document.get("embedding")),
    }
    if similarity is not None:
        payload["similarity"] = float(similarity)
    return payload


@image_api_bp.route("/health", methods=["GET"])
def health() -> tuple:
    return (
        jsonify(
            {
                "ok": True,
                "mongo_db_prefix": MONGO_DB_PREFIX,
                "clip_available": clip_available(),
                # Empty when CLIP is fine; the reason it is not, otherwise.
                "clip_error": clip_error(),
            }
        ),
        200,
    )


@image_api_bp.route("/upload-image", methods=["POST"])
def upload_image() -> tuple:
    image_file = request.files.get("image")
    if image_file is None:
        return jsonify({"error": "No image provided"}), 400
    if image_file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    metadata = _safe_json_load(request.form.get("metadata"), fallback={})
    tags = _safe_json_load(request.form.get("tags"), fallback=[])
    if not isinstance(metadata, dict):
        metadata = {}
    if not isinstance(tags, list):
        tags = []

    db, fs, meta_collection, db_name = _get_database()

    raw_image = image_file.read()
    embedding_vectors = embed_images([raw_image])
    embedding = embedding_vectors[0].tolist() if embedding_vectors is not None else None

    file_id = fs.put(
        raw_image,
        filename=image_file.filename,
        content_type=image_file.mimetype,
    )

    document = {
        "file_id": file_id,
        "filename": image_file.filename,
        "content_type": image_file.mimetype,
        "size_bytes": len(raw_image),
        "tags": [str(tag) for tag in tags],
        "metadata": metadata,
        "embedding": embedding,
        "embedding_model": clip_model_tag() if embedding else None,
        "created_at": dt.datetime.utcnow().isoformat() + "Z",
    }
    insert_result = meta_collection.insert_one(document)
    _invalidate_embedding_index(db_name)
    stored = meta_collection.find_one({"_id": insert_result.inserted_id})
    return jsonify({"message": "Image uploaded", "image": _serialize_document(stored, db_name=db_name), "database": db_name}), 201


@image_api_bp.route("/upload-batch", methods=["POST"])
def upload_batch() -> tuple:
    image_files = request.files.getlist("images")
    if not image_files:
        return jsonify({"error": "No images provided"}), 400

    metadata_by_name = _safe_json_load(request.form.get("metadata_by_name"), fallback={})
    if not isinstance(metadata_by_name, dict):
        metadata_by_name = {}

    db, fs, meta_collection, db_name = _get_database()

    inserted_ids = []
    for image_file in image_files:
        if image_file.filename == "":
            continue
        filename = image_file.filename
        content_type = image_file.mimetype
        raw = image_file.read()
        file_id = fs.put(raw, filename=filename, content_type=content_type)
        item_meta = metadata_by_name.get(filename, {})
        if not isinstance(item_meta, dict):
            item_meta = {}
        tags = item_meta.get("tags", [])
        if not isinstance(tags, list):
            tags = []

        document = {
            "file_id": file_id,
            "filename": filename,
            "content_type": content_type,
            "size_bytes": len(raw),
            "tags": [str(tag) for tag in tags],
            "metadata": {k: v for k, v in item_meta.items() if k != "tags"},
            # F1 computes embeddings in bounded batches after upload.
            "embedding": None,
            "created_at": dt.datetime.utcnow().isoformat() + "Z",
        }
        inserted = meta_collection.insert_one(document)
        inserted_ids.append(inserted.inserted_id)

    if not inserted_ids:
        return jsonify({"error": "No valid images provided"}), 400

    created_docs = list(meta_collection.find({"_id": {"$in": inserted_ids}}))
    _invalidate_embedding_index(db_name)
    created_docs.sort(key=lambda doc: inserted_ids.index(doc["_id"]))

    return (
        jsonify(
            {
                "message": "Batch uploaded",
                "uploaded_count": len(created_docs),
                "images": [_serialize_document(doc, db_name=db_name) for doc in created_docs],
                "database": db_name,
            }
        ),
        201,
    )


@image_api_bp.route("/images", methods=["GET"])
def list_images() -> tuple:
    db, fs, meta_collection, db_name = _get_database()

    try:
        limit = max(1, min(int(request.args.get("limit", 120)), 1000))
    except (TypeError, ValueError):
        limit = 120
    try:
        skip = max(0, int(request.args.get("skip", 0)))
    except (TypeError, ValueError):
        skip = 0

    cursor = meta_collection.find().sort("created_at", -1).skip(skip).limit(limit)
    docs = [_serialize_document(doc, db_name=db_name) for doc in cursor]
    return jsonify({"images": docs, "count": len(docs), "database": db_name}), 200


@image_api_bp.route("/semantic-search", methods=["GET"])
def semantic_search() -> tuple:
    db, fs, meta_collection, db_name = _get_database()

    query = (request.args.get("query") or "").strip()
    if not query:
        return jsonify({"error": "query is required"}), 400

    try:
        top_k = max(1, min(int(request.args.get("top_k", 80)), 250))
    except (TypeError, ValueError):
        top_k = 80

    query_embedding = embed_text(query)
    scored: list[tuple[dict, float]] = []

    clip_used = False
    if query_embedding is not None:
        index = _embedding_index(meta_collection, db_name)
        matrix = index["matrix"]
        query_vector = np.asarray(query_embedding, dtype=np.float32)
        if matrix.size and query_vector.ndim == 1 and matrix.shape[1] == query_vector.size:
            scores = matrix @ query_vector
            limit = min(top_k, scores.shape[0])
            if limit:
                if limit == scores.shape[0]:
                    top_indices = np.argsort(scores)[::-1]
                else:
                    top_indices = np.argpartition(scores, -limit)[-limit:]
                    top_indices = top_indices[np.argsort(scores[top_indices])[::-1]]
                scored = [(index["docs"][int(item)], float(scores[int(item)])) for item in top_indices]

        clip_used = bool(scored)

    if not scored:
        fallback_cursor = meta_collection.find(
            {},
            {
                "file_id": 1,
                "filename": 1,
                "content_type": 1,
                "size_bytes": 1,
                "tags": 1,
                "metadata": 1,
                "features": 1,
                "created_at": 1,
                "embedding": {"$slice": 1},
            },
        )
        for doc in fallback_cursor:
            scored.append((doc, _fallback_match_score(doc, query)))

    scored.sort(key=lambda pair: pair[1], reverse=True)
    results = [_serialize_document(doc, score, db_name=db_name) for doc, score in scored[:top_k]]

    return (
        jsonify(
            {
                "query": query,
                "results": results,
                "count": len(results),
                "clip_used": clip_used,
                "database": db_name,
            }
        ),
        200,
    )


@image_api_bp.route("/image/<file_id>", methods=["GET"])
def get_image(file_id: str):
    db, fs, meta_collection, db_name = _get_database()

    try:
        grid_out = fs.get(_to_object_id(file_id))
    except Exception:
        return jsonify({"error": "Image not found"}), 404

    return send_file(
        grid_out,
        mimetype=getattr(grid_out, "content_type", None) or "application/octet-stream",
        download_name=getattr(grid_out, "filename", "image"),
    )
