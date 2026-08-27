"""
Database management API - handle multiple databases and switching.
Each database has its own MongoDB database in the instance.
"""

from __future__ import annotations

import os
from datetime import datetime
import time
from bson import ObjectId
from pymongo import MongoClient, ASCENDING
from flask import Blueprint, jsonify, request

database_api_bp = Blueprint("database_api", __name__)

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
MONGO_DB_PREFIX = os.getenv("MONGO_DB_PREFIX", "warden_ship")
# Store metadata about databases in a special database
# 500 ms was tight enough to report a healthy local MongoDB as "offline" while
# the machine was busy starting the desktop app; 3 s still fails fast.
_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000, connectTimeoutMS=3000)
_meta_db = _client[f"{MONGO_DB_PREFIX}_meta"]
_databases_collection = _meta_db["databases"]

# Defer index creation to first use
_index_created = False
_mongo_available_cache: bool | None = None
_mongo_available_checked_at = 0.0


def _is_mongo_available() -> bool:
    global _mongo_available_cache, _mongo_available_checked_at
    now = time.monotonic()
    cache_ttl = 10.0 if _mongo_available_cache else 1.0
    if _mongo_available_cache is not None and now - _mongo_available_checked_at < cache_ttl:
        return _mongo_available_cache
    try:
        _client.admin.command("ping")
        _mongo_available_cache = True
    except Exception:
        _mongo_available_cache = False
    _mongo_available_checked_at = now
    return _mongo_available_cache


def _json_safe(value):
    """Convert Mongo/Python values into data Flask can always JSON encode."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat() + "Z"
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


def _serialize_database_info(db_info: dict | None) -> dict | None:
    if db_info is None:
        return None
    payload = _json_safe(db_info)
    payload.pop("_id", None)
    return payload


def _ensure_indices():
    """Create indices if not already created."""
    global _index_created
    if not _index_created and _is_mongo_available():
        try:
            _databases_collection.create_index([("name", ASCENDING)], unique=True)
            _index_created = True
        except Exception as e:
            print(f"Warning: Could not create index: {e}")


def _get_or_create_db(db_name: str):
    """Get or create a database with the given name."""
    full_db_name = f"{MONGO_DB_PREFIX}_{db_name}"
    return _client[full_db_name]


def _safe_count(db_name: str) -> int:
    if not _is_mongo_available():
        return 0
    try:
        return _get_database_count(db_name)
    except Exception:
        return 0


def _register_database(name: str, description: str = "") -> dict:
    """Register a new database in metadata."""
    _ensure_indices()
    now = datetime.utcnow().isoformat() + "Z"
    db_info = {
        "name": name,
        "description": description,
        "created_at": now,
        "updated_at": now,
        "image_count": 0,
        "indexed": False,
    }
    _databases_collection.insert_one(db_info)
    return _serialize_database_info(db_info)


def _get_database_count(db_name: str) -> int:
    """Get number of images in a database."""
    db = _get_or_create_db(db_name)
    meta_collection = db["image_metadata"]
    return meta_collection.count_documents({})


def _discover_database_info(db_name: str) -> dict | None:
    """Build metadata for a Mongo database that exists without a metadata row."""
    full_db_name = f"{MONGO_DB_PREFIX}_{db_name}"
    if full_db_name not in _client.list_database_names():
        return None
    return {
        "name": db_name,
        "description": "Existing Mongo image database",
        "image_count": _safe_count(db_name),
        "indexed": False,
        "source": "database",
    }


@database_api_bp.route("/list", methods=["GET"])
def list_databases():
    """List all available databases."""
    databases_by_name = {}

    if not _is_mongo_available():
        return jsonify({
            "status": "success",
            "databases": [],
            "count": 0,
            "mongo_available": False,
            "message": "MongoDB is offline. Start MongoDB to choose or upload datasets.",
        })

    try:
        if _is_mongo_available():
            _ensure_indices()
            for db_info in _databases_collection.find({}):
                db_info = _serialize_database_info(db_info)
                db_info["image_count"] = _safe_count(db_info["name"])
                db_info.setdefault("source", "database")
                databases_by_name[db_info["name"]] = db_info
    except Exception as e:
        print(f"Warning: metadata database unavailable: {e}")

    try:
        if _is_mongo_available():
            prefix = f"{MONGO_DB_PREFIX}_"
            for full_name in _client.list_database_names():
                if not full_name.startswith(prefix) or full_name.endswith("_meta"):
                    continue
                name = full_name.removeprefix(prefix)
                databases_by_name.setdefault(name, _discover_database_info(name))
    except Exception as e:
        print(f"Warning: could not discover Mongo databases: {e}")

    try:
        dbs = sorted(
            (_serialize_database_info(item) for item in databases_by_name.values()),
            key=lambda item: item["name"],
        )
        return jsonify({
            "status": "success",
            "databases": dbs,
            "count": len(dbs),
            "mongo_available": True,
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e),
        }), 500


@database_api_bp.route("/create", methods=["POST"])
def create_database():
    """Create a new database."""
    try:
        if not _is_mongo_available():
            return jsonify({
                "status": "error",
                "message": "MongoDB is offline. Start MongoDB before creating a dataset.",
            }), 503
        data = request.get_json() or {}
        name = data.get("name", "").strip()
        description = data.get("description", "").strip()

        if not name:
            return jsonify({
                "status": "error",
                "message": "Database name is required",
            }), 400

        if not name.replace("_", "").replace("-", "").isalnum():
            return jsonify({
                "status": "error",
                "message": "Database name must contain only alphanumeric, hyphens, and underscores",
            }), 400

        # Check if already exists
        existing = _databases_collection.find_one({"name": name})
        if existing or _discover_database_info(name):
            return jsonify({
                "status": "error",
                "message": f"Database '{name}' already exists",
            }), 409

        # Create the database (will be created when first collection is added)
        db = _get_or_create_db(name)
        if "image_metadata" not in db.list_collection_names():
            db.create_collection("image_metadata")

        # Register in metadata
        db_info = _register_database(name, description)

        return jsonify({
            "status": "success",
            "database": db_info,
        }), 201
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e),
        }), 500


@database_api_bp.route("/get/<db_name>", methods=["GET"])
def get_database_info(db_name: str):
    """Get information about a specific database."""
    try:
        if not _is_mongo_available():
            return jsonify({
                "status": "error",
                "message": "MongoDB is offline. Start MongoDB before loading datasets.",
            }), 503
        db_info = _serialize_database_info(
            _databases_collection.find_one({"name": db_name})
        )

        if not db_info:
            db_info = _discover_database_info(db_name)

        if not db_info:
            return jsonify({
                "status": "error",
                "message": f"Database '{db_name}' not found",
            }), 404

        # Get current image count
        try:
            db_info["image_count"] = _get_database_count(db_name)
        except Exception:
            db_info["image_count"] = 0

        return jsonify({
            "status": "success",
            "database": db_info,
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e),
        }), 500


@database_api_bp.route("/delete/<db_name>", methods=["DELETE"])
def delete_database(db_name: str):
    """Delete a database and all its data."""
    try:
        if not _is_mongo_available():
            return jsonify({
                "status": "error",
                "message": "MongoDB is offline. Start MongoDB before removing datasets.",
            }), 503
        if db_name == "default":
            return jsonify({
                "status": "error",
                "message": "The default dataset cannot be removed.",
            }), 400
        # Check if exists
        db_info = _serialize_database_info(
            _databases_collection.find_one({"name": db_name})
        )
        if not db_info:
            db_info = _discover_database_info(db_name)
        if not db_info:
            return jsonify({
                "status": "error",
                "message": f"Database '{db_name}' not found",
            }), 404

        # Delete from MongoDB
        full_db_name = f"{MONGO_DB_PREFIX}_{db_name}"
        _client.drop_database(full_db_name)

        # Remove from metadata
        _databases_collection.delete_one({"name": db_name})

        return jsonify({
            "status": "success",
            "message": f"Database '{db_name}' deleted",
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e),
        }), 500


@database_api_bp.route("/get-active", methods=["GET"])
def get_active_database():
    """Get the currently active database name from session."""
    db_name = request.args.get("db_name", "default")

    try:
        if not _is_mongo_available():
            return jsonify({
                "status": "success",
                "database_name": "default",
                "exists": False,
                "mongo_available": False,
                "message": "MongoDB is offline. Start MongoDB to choose or upload datasets.",
            })
        db_info = _serialize_database_info(
            _databases_collection.find_one({"name": db_name})
        )

        if not db_info:
            db_info = _discover_database_info(db_name)

        if not db_info:
            # Return default if doesn't exist
            db_info = _serialize_database_info(
                _databases_collection.find_one({"name": "default"})
            )
            if not db_info:
                db_info = _discover_database_info("default")
            if not db_info:
                return jsonify({
                    "status": "success",
                    "database_name": "default",
                    "exists": False,
                })

        try:
            db_info["image_count"] = _get_database_count(db_info["name"])
        except Exception:
            db_info["image_count"] = 0

        return jsonify({
            "status": "success",
            "exists": True,
            "database": db_info,
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e),
        }), 500
