"""
Pipeline management API – trigger and monitor feature pipelines.
Stores state of running pipelines in memory and on disk.
"""

from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from bson import ObjectId
from flask import Blueprint, jsonify, request
from backend.api.clip_service import clip_model_tag, embed_images
from backend.f2_classification import classify_image
from backend import paths
from backend.pipeline_state_store import (
    read_pipeline_state_file,
    update_pipeline_state_file,
    write_pipeline_state,
)
from pymongo import MongoClient
from pymongo.errors import PyMongoError
from gridfs import GridFS

pipeline_api_bp = Blueprint("pipeline_api", __name__)

BACKEND_ROOT = Path(__file__).resolve().parents[1]
# State and feature output must live outside the (possibly read-only) bundle.
PIPELINE_STATE_FILE = paths.PIPELINE_STATE_FILE

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "warden_ship")
MONGO_DB_PREFIX = os.getenv("MONGO_DB_PREFIX", "warden_ship")

_PROCESS_LOCK = threading.Lock()
_RUNNING_PROCESSES: dict[str, subprocess.Popen] = {}

# F5 dates the works that carry no date with the trained year head, and the head
# reads the CLIP vectors F1 writes onto each image_metadata document. Started
# side by side the two lose the race - F5 extracts its manifest before F1 has
# written anything, finds no vectors, and every undated work stays undated. So a
# request for F5 becomes an F1 -> F5 chain whenever the vectors are not there yet.
PIPELINE_DEPENDENCIES: dict[str, tuple[str, ...]] = {"f5": ("f1",)}

_LEADING_CATALOG_ID_PATTERN = re.compile(
    r"^(?:(?:[a-f0-9]{12,24})|(?:\d{3,})|(?:image|archive|painting|file)[-_ ]*\d*)[-_ ]+",
    re.IGNORECASE,
)
_UNKNOWN_NAME_PARTS = {
    "unknown",
    "unknown artist",
    "unknown artwork",
    "unidentified",
    "unattributed",
    "n/a",
}


def _needs_logbook_classification(filename: object) -> bool:
    name = Path(str(filename or "")).stem
    clean_name = _LEADING_CATALOG_ID_PATTERN.sub("", name).replace("_", " ").strip()
    parts = [
        part.strip()
        for part in re.split(r"\s+(?:--|-|\u2013|\u2014)\s+", clean_name, maxsplit=1)
    ]
    if len(parts) < 2 or not all(parts):
        return True
    return any(part.lower() in _UNKNOWN_NAME_PARTS for part in parts)


def _load_state() -> dict:
    """Load pipeline state from disk."""
    return read_pipeline_state_file(PIPELINE_STATE_FILE)


def _json_safe(value):
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


def _write_pipeline_state(
    pipeline_name: str,
    *,
    status: str = "running",
    progress: int = 0,
    stage: str = "queued",
    message: str = "",
    error: str | None = None,
    can_use: bool = False,
    extra: dict | None = None,
) -> None:
    write_pipeline_state(
        PIPELINE_STATE_FILE,
        pipeline_name,
        status=status,
        progress=progress,
        stage=stage,
        message=message,
        error=error,
        can_use=can_use,
        extra=extra,
    )


def _resolve_mongo_db_name(db_name: str | None = None) -> str:
    if db_name:
        return f"{MONGO_DB_PREFIX}_{db_name}"
    configured = os.getenv("MONGO_DB_NAME")
    if configured and configured != "warden_ship":
        return configured
    return f"{MONGO_DB_PREFIX}_default"


def _clip_embeddings_missing(db_name: str | None) -> bool:
    """True when any image still lacks the CLIP vector the F5 year head needs."""
    try:
        client = MongoClient(MONGO_URI)
        meta = client[_resolve_mongo_db_name(db_name)]["image_metadata"]
        return meta.count_documents(
            {"$or": [{"embedding": {"$exists": False}}, {"embedding": None}, {"embedding": []}]},
            limit=1,
        ) > 0
    except PyMongoError:
        # If the database cannot answer, run F1 anyway: a redundant embedding
        # pass costs time, a history map with no dates on it costs credibility.
        return True


def _plan_pipeline_chains(pipelines: list[str], db_name: str | None) -> list[list[str]]:
    """Group the requested pipelines into chains that run one step at a time.

    Chains run in parallel with each other, steps within a chain run in order.
    """
    requested = list(dict.fromkeys(pipelines))
    chains: list[list[str]] = []
    chained: set[str] = set()

    for name in requested:
        prerequisites = [
            dep for dep in PIPELINE_DEPENDENCIES.get(name, ())
            if dep in requested or _clip_embeddings_missing(db_name)
        ]
        if not prerequisites:
            continue
        chains.append([*prerequisites, name])
        chained.update(prerequisites)
        chained.add(name)

    chains.extend([name] for name in requested if name not in chained)
    return chains


def _run_pipeline_chain(chain: list[str], db_name: str | None) -> None:
    """Run one chain in order, abandoning the rest if a step does not finish."""
    for position, pipeline_name in enumerate(chain):
        _run_pipeline_worker(pipeline_name, use_mongodb=True, db_name=db_name)
        if _load_state().get(pipeline_name, {}).get("status") == "completed":
            continue
        for skipped in chain[position + 1:]:
            _write_pipeline_state(
                skipped,
                status="failed",
                progress=0,
                stage="failed",
                message=f"Skipped: {pipeline_name.upper()} did not finish",
                can_use=False,
                error=f"{pipeline_name.upper()} is required by {skipped.upper()} and did not complete",
            )
        return


def _safe_output_name(db_name: str | None) -> str:
    value = (db_name or "default").strip() or "default"
    return "".join(char if char.isalnum() or char in {"-", "_"} else "_" for char in value)


def _invalidate_f1_search_cache(db_name: str | None) -> None:
    try:
        from backend.api.image_api import _invalidate_embedding_index

        _invalidate_embedding_index(db_name or "default")
    except Exception:
        pass


def _terminate_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "nt":
            process.terminate()
        else:
            os.killpg(process.pid, signal.SIGTERM)
    except Exception:
        try:
            process.terminate()
        except Exception:
            pass


def _kill_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "nt":
            process.kill()
        else:
            os.killpg(process.pid, signal.SIGKILL)
    except Exception:
        try:
            process.kill()
        except Exception:
            pass


def _run_subprocess_with_cancel(
    pipeline_name: str,
    cmd: list[str],
    *,
    timeout: float,
) -> tuple[int | None, str, str, bool]:
    # Stream the child's stdout+stderr to a temp file rather than OS pipes.
    # Verbose steps (MediaPipe/TensorFlow in F6 step 6) emit far more than the
    # ~64KB pipe buffer; with stdout=PIPE the child blocks on write while we
    # only poll() and never read, which deadlocks the run ("pauses on step 6").
    # A regular file has no such limit, so the child can never stall on output.
    log_file = tempfile.TemporaryFile(mode="w+")
    # Run from a writable scratch dir: ultralytics & friends download weights
    # into the current directory, and in a packaged build the code lives on a
    # read-only mount.
    paths.WORK_DIR.mkdir(parents=True, exist_ok=True)
    # cwd is no longer the import root, so `python -m backend...` needs the
    # project root (the parent of the `app` package) on PYTHONPATH explicitly.
    env = dict(os.environ)
    import_root = str(paths.BACKEND_ROOT.parents[0])
    env["PYTHONPATH"] = os.pathsep.join(
        part for part in (import_root, env.get("PYTHONPATH")) if part
    )
    process = subprocess.Popen(
        cmd,
        cwd=str(paths.WORK_DIR),
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=os.name != "nt",
    )
    with _PROCESS_LOCK:
        _RUNNING_PROCESSES[pipeline_name] = process

    def _read_log(limit: int = 16000) -> str:
        # Return the tail of the captured output — that's where any traceback is.
        try:
            log_file.flush()
            log_file.seek(0)
            data = log_file.read()
        except Exception:
            return ""
        return data[-limit:] if len(data) > limit else data

    started = time.monotonic()
    cancelled = False
    timed_out = False
    try:
        while process.poll() is None:
            if time.monotonic() - started > timeout:
                timed_out = True
                _terminate_process(process)
                break
            if _load_state().get(pipeline_name, {}).get("status") == "cancelled":
                cancelled = True
                _terminate_process(process)
                break
            time.sleep(0.5)

        # Ensure the process is fully gone before reading the final log.
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _kill_process(process)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass

        output = _read_log()
        if timed_out and not output.strip():
            output = "Pipeline timed out"
        return process.returncode, "", output, cancelled
    finally:
        try:
            log_file.close()
        except Exception:
            pass
        with _PROCESS_LOCK:
            if _RUNNING_PROCESSES.get(pipeline_name) is process:
                _RUNNING_PROCESSES.pop(pipeline_name, None)


def _extract_images_from_mongodb(
    temp_dir: str,
    db_name: str | None = None,
    pipeline_name: str | None = None,
) -> int:
    """Extract all images from MongoDB GridFS to a temp directory. Returns count."""
    try:
        client = MongoClient(MONGO_URI)
        db = client[_resolve_mongo_db_name(db_name)]
        fs = GridFS(db, collection="images")
        meta_collection = db["image_metadata"]
        metadata_by_file_id = {
            str(doc.get("file_id")): doc for doc in meta_collection.find({})
        }

        count = 0
        temp_path = Path(temp_dir)
        temp_path.mkdir(parents=True, exist_ok=True)
        manifest = {"database": db_name or "default", "images": []}
        total = db["images.files"].count_documents({})

        for grid_out in fs.find():
            try:
                filename = grid_out.filename or f"image_{count}.jpg"
                safe_name = Path(filename).name or f"image_{count}.jpg"
                output_file = temp_path / safe_name
                if output_file.exists():
                    output_file = temp_path / f"{count:04d}_{safe_name}"
                output_file.parent.mkdir(parents=True, exist_ok=True)
                with output_file.open("wb") as f:
                    f.write(grid_out.read())

                meta_doc = metadata_by_file_id.get(str(grid_out._id), {})
                image_url = f"/api/image/image/{grid_out._id}?db_name={db_name or 'default'}"
                manifest["images"].append(
                    {
                        "id": str(meta_doc.get("_id") or grid_out._id),
                        "file_id": str(grid_out._id),
                        "filename": filename,
                        "relative_path": output_file.name,
                        "path": output_file.name,
                        "content_type": getattr(grid_out, "content_type", None),
                        "size_bytes": getattr(grid_out, "length", None),
                        "tags": _json_safe(meta_doc.get("tags", [])),
                        "metadata": _json_safe(meta_doc.get("metadata", {})),
                        "embedding": _json_safe(meta_doc.get("embedding")),
                        "created_at": _json_safe(meta_doc.get("created_at")),
                        "image_url": image_url,
                    }
                )
                count += 1
                if pipeline_name and total:
                    _write_pipeline_state(
                        pipeline_name,
                        progress=2 + int((count / total) * 6),
                        stage="extract",
                        message=f"Unpacking images from MongoDB {count}/{total}",
                        extra={"current": count, "total": total},
                    )
            except Exception as e:
                print(f"Error extracting {grid_out.filename}: {e}")
                continue

        with (temp_path / "_mongo_manifest.json").open("w", encoding="utf-8") as handle:
            json.dump(manifest, handle)

        return count

    except Exception as e:
        print(f"Error connecting to MongoDB: {e}")
        return 0


def _run_pipeline_worker(pipeline_name: str, use_mongodb: bool = True, db_name: str | None = None) -> None:
    """Worker thread to run pipeline asynchronously."""
    temp_dir = None
    print(f"Running pipeline: {pipeline_name}")  # Debugging line
    try:
        _write_pipeline_state(
            pipeline_name,
            status="running",
            progress=1,
            stage="queued",
            message=f"Preparing {pipeline_name.upper()} analysis",
        )

        if pipeline_name in {"f1", "f2"}:
            print(f"Starting {pipeline_name.upper()} pipeline")  # Debugging line
            # F1 and F2 operate directly against the database.
            client = MongoClient(MONGO_URI)
            full_db = _resolve_mongo_db_name(db_name)
            db = client[full_db]
            fs = GridFS(db, collection="images")
            meta = db["image_metadata"]
            # count documents to process
            cursor = meta.find({})
            count = cursor.count() if hasattr(cursor, "count") else meta.count_documents({})
            print(f"Found {count} images to process for {pipeline_name.upper()}")  # Debugging line
            if count == 0:
                raise ValueError(f"No images found in MongoDB for {pipeline_name.upper()} pipeline")
            image_root = None
        else:
            temp_dir = tempfile.mkdtemp(prefix=f"{pipeline_name}_images_")
            image_count = _extract_images_from_mongodb(
                temp_dir,
                db_name=db_name,
                pipeline_name=pipeline_name,
            )
            if image_count == 0:
                raise ValueError(f"No images found in MongoDB for {pipeline_name.upper()} pipeline")
            image_root = temp_dir

        # Determine output directory based on pipeline
        if pipeline_name == "f5":
            output_dir = str(paths.f5_output_root() / _safe_output_name(db_name))
            module_path = "backend.f5_history_map.run_pipeline"
        elif pipeline_name == "f6":
            output_dir = str(paths.f6_output_root() / _safe_output_name(db_name))
            module_path = "backend.f6_attributes.run_pipeline"
        elif pipeline_name == "f1":
            # For f1 we handle embeddings inline rather than running a subprocess
            # Process images in batches and update meta collection with embeddings
            try:
                print("Processing images in batches")  # Debugging line
                # iterate through documents in batches
                batch_size = 32
                processed = 0
                docs_cursor = meta.find({})
                docs_list = list(docs_cursor)
                total = len(docs_list)
                for i in range(0, total, batch_size):
                    batch = docs_list[i : i + batch_size]
                    images_bytes = []
                    ids = []
                    for doc in batch:
                        try:
                            grid_out = fs.get(doc["file_id"])
                            images_bytes.append(grid_out.read())
                            ids.append(doc["_id"])
                        except Exception:
                            ids.append(None)
                            images_bytes.append(None)

                    # filter valid
                    valid_pairs = [(idx, b) for idx, b in enumerate(images_bytes) if b]
                    if valid_pairs:
                        raws = [b for _, b in valid_pairs]
                        embeddings = embed_images(raws)
                        if embeddings is None:
                            # CLIP unavailable; mark pipeline failed
                            raise RuntimeError("CLIP runtime unavailable")
                        # update documents
                        emb_idx = 0
                        for idx, raw in valid_pairs:
                            doc_id = ids[idx]
                            if doc_id is None:
                                continue
                            vec = embeddings[emb_idx].tolist()
                            emb_idx += 1
                            meta.update_one(
                                {"_id": doc_id},
                                {"$set": {"embedding": vec, "embedding_model": clip_model_tag()}},
                            )

                    processed += len(batch)
                    percent = int((processed / total) * 100)
                    print(f"Progress: {percent}%")
                    _write_pipeline_state(
                        pipeline_name,
                        progress=percent,
                        stage="embedding",
                        message=f"Computing CLIP embeddings {processed}/{total}",
                        extra={"current": processed, "total": total},
                    )
                    # allow cancel check
                    cur_state = _load_state().get(pipeline_name, {})
                    if cur_state.get("status") == "cancelled":
                        _invalidate_f1_search_cache(db_name)
                        _write_pipeline_state(
                            pipeline_name,
                            status="cancelled",
                            progress=percent,
                            stage="cancelled",
                            message="F1 embedding job cancelled",
                        )
                        return

                # Completed
                print("F1 pipeline completed successfully")
                _invalidate_f1_search_cache(db_name)
                _write_pipeline_state(
                    pipeline_name,
                    status="completed",
                    progress=100,
                    stage="ready",
                    message="F1 semantic search is ready",
                    can_use=True,
                )
                return
            except Exception as e:
                _write_pipeline_state(
                    pipeline_name,
                    status="failed",
                    progress=0,
                    stage="failed",
                    message="F1 embedding job failed",
                    can_use=False,
                    error=str(e),
                )
                return
        elif pipeline_name == "f2":
            try:
                docs_list = [
                    doc
                    for doc in meta.find({})
                    if _needs_logbook_classification(doc.get("filename"))
                ]
                total = len(docs_list)
                processed = 0

                for doc in docs_list:
                    try:
                        grid_out = fs.get(doc["file_id"])
                        image_bytes = grid_out.read()
                        hints = {}
                        if isinstance(doc.get("metadata"), dict):
                            hints.update(doc["metadata"])
                        if isinstance(doc.get("tags"), list):
                            hints.setdefault("tags", doc.get("tags"))

                        prediction = classify_image(image_bytes, top_k=5, hints=hints)
                        f2_features = {
                            "source": prediction.get("source"),
                            "model_available": prediction.get("model_available"),
                            "elapsed_ms": prediction.get("elapsed_ms"),
                            "style": prediction.get("style"),
                            "genre": prediction.get("genre"),
                            "artist": prediction.get("artist"),
                            "updated_at": time.time(),
                        }
                        meta.update_one(
                            {"_id": doc["_id"]},
                            {"$set": {"features.f2": f2_features}},
                        )
                    except Exception as item_error:
                        print(f"F2 classification failed for {doc.get('filename')}: {item_error}")

                    processed += 1
                    percent = int((processed / total) * 100) if total else 100
                    _write_pipeline_state(
                        pipeline_name,
                        progress=percent,
                        stage="classification",
                        message=f"Classifying logbook entries {processed}/{total}",
                        extra={"current": processed, "total": total},
                    )

                    cur_state = _load_state().get(pipeline_name, {})
                    if cur_state.get("status") == "cancelled":
                        _write_pipeline_state(
                            pipeline_name,
                            status="cancelled",
                            progress=percent,
                            stage="cancelled",
                            message="F2 classification job cancelled",
                        )
                        return

                _write_pipeline_state(
                    pipeline_name,
                    status="completed",
                    progress=100,
                    stage="ready",
                    message="F2 logbook classifications are ready",
                    can_use=True,
                )
                return
            except Exception as e:
                _write_pipeline_state(
                    pipeline_name,
                    status="failed",
                    progress=0,
                    stage="failed",
                    message="F2 classification job failed",
                    can_use=False,
                    error=str(e),
                )
                return
        else:
            raise ValueError(f"Unknown pipeline: {pipeline_name}")

        # Ensure output directory exists
        Path(output_dir).mkdir(parents=True, exist_ok=True)

        cmd = [
            sys.executable,
            "-m",
            module_path,
            image_root,
            output_dir,
        ]
        if pipeline_name == "f5":
            cmd.extend(["--state-file", str(PIPELINE_STATE_FILE), "--pipeline-name", pipeline_name])
            _write_pipeline_state(
                pipeline_name,
                progress=9,
                stage="handoff",
                message="Starting F5 style-space builder",
            )
        else:
            cmd.extend(["--state-file", str(PIPELINE_STATE_FILE), "--pipeline-name", pipeline_name])
            _write_pipeline_state(
                pipeline_name,
                progress=12,
                stage="analysis",
                message=f"Running {pipeline_name.upper()} feature scripts",
            )

        returncode, _stdout, stderr, cancelled = _run_subprocess_with_cancel(
            pipeline_name,
            cmd,
            timeout=3600,
        )

        if cancelled:
            _write_pipeline_state(
                pipeline_name,
                status="cancelled",
                progress=_load_state().get(pipeline_name, {}).get("progress", 0),
                stage="cancelled",
                message=f"{pipeline_name.upper()} analysis cancelled",
                can_use=False,
            )
        elif returncode == 0:
            _write_pipeline_state(
                pipeline_name,
                status="completed",
                progress=100,
                stage="ready",
                message=f"{pipeline_name.upper()} features are ready",
                can_use=True,
            )
        else:
            _write_pipeline_state(
                pipeline_name,
                status="failed",
                progress=0,
                stage="failed",
                message=f"{pipeline_name.upper()} analysis failed",
                can_use=False,
                error=stderr or "Pipeline failed with unknown error",
            )

    except Exception as e:
        _write_pipeline_state(
            pipeline_name,
            status="failed",
            progress=0,
            stage="failed",
            message=f"{pipeline_name.upper()} analysis failed",
            can_use=False,
            error=str(e),
        )

    finally:
        # Clean up temp directory
        if temp_dir and Path(temp_dir).exists():
            try:
                import shutil
                shutil.rmtree(temp_dir)
            except Exception:
                pass


@pipeline_api_bp.route("/run", methods=["POST"])
def run_pipeline() -> tuple:
    """
    Trigger one or more pipelines to run in the background.
    Images are automatically extracted from MongoDB.

    A pipeline can pull in a prerequisite that was not requested: asking for F5
    also runs F1 first when the CLIP vectors its year head needs are missing.

    Request JSON:
    {
      "pipelines": ["f5", "f6"]  # or just one
    }

    Returns:
    {
      "ok": true,
      "message": "Pipelines started",
      "pipelines": ["f1", "f5", "f6"],   # everything that will actually run
      "requested": ["f5", "f6"],
      "chains": [["f1", "f5"], ["f6"]]   # steps inside a chain run in order
    }
    """
    data = request.get_json() or {}
    pipelines = data.get("pipelines", [])

    if not isinstance(pipelines, list) or not pipelines:
        return jsonify({"ok": False, "error": "pipelines must be a non-empty list"}), 400

    # Validate pipeline names
    for pipeline_name in pipelines:
        if pipeline_name not in ["f5", "f6", "f1", "f2"]:
            return jsonify({"ok": False, "error": f"Unknown pipeline: {pipeline_name}"}), 400

    # Optional database name for F1 / targeted pipelines
    db_name = data.get("db_name")

    # A pipeline may pull in a prerequisite that was not asked for (see
    # PIPELINE_DEPENDENCIES); those run first, in the same chain.
    chains = _plan_pipeline_chains(pipelines, db_name)
    scheduled = [name for chain in chains for name in chain]

    for chain in chains:
        for position, pipeline_name in enumerate(chain):
            waiting_for = chain[position - 1].upper() if position else ""
            _write_pipeline_state(
                pipeline_name,
                status="running",
                progress=0,
                stage="queued",
                message=(
                    f"Waiting for {waiting_for} to finish first"
                    if waiting_for
                    else f"Queued {pipeline_name.upper()} analysis"
                ),
                can_use=False,
                extra={"db_name": db_name or "default"},
            )
        thread = threading.Thread(
            target=_run_pipeline_chain,
            args=(chain, db_name),
            daemon=True,
        )
        thread.start()

    return (
        jsonify(
            {
                "ok": True,
                "message": "Pipelines started in background",
                "pipelines": scheduled,
                "requested": pipelines,
                "chains": chains,
            }
        ),
        202,
    )


@pipeline_api_bp.route("/status", methods=["GET"])
def status() -> tuple:
    """
    Get status of running/completed pipelines.

    Query params:
    - pipelines: comma-separated list (e.g., "f5,f6") or empty for all

    Returns:
    {
      "ok": true,
      "pipelines": {
        "f5": {
          "status": "running|completed|failed|idle",
          "progress": 0-100,
          "error": null or error message
        },
        ...
      }
    }
    """
    pipelines_param = request.args.get("pipelines", "")
    pipelines = (
        [p.strip() for p in pipelines_param.split(",") if p.strip()]
        if pipelines_param
        else ["f1", "f2", "f5", "f6"]
    )

    state = _load_state()
    result = {}

    for pipeline_name in pipelines:
        result[pipeline_name] = state.get(pipeline_name, {"status": "idle", "progress": 0})

    return jsonify({"ok": True, "pipelines": result}), 200


@pipeline_api_bp.route("/cancel", methods=["POST"])
def cancel() -> tuple:
    """
    Cancel a running pipeline and terminate its subprocess when it has one.

    Request JSON:
    {
      "pipelines": ["f5"]
    }
    """
    data = request.get_json() or {}
    pipelines = data.get("pipelines", [])

    if not isinstance(pipelines, list):
        return jsonify({"ok": False, "error": "pipelines must be a list"}), 400

    def mark_cancelled(state: dict) -> None:
        now = time.time()
        for pipeline_name in pipelines:
            payload = state.get(pipeline_name, {})
            payload["status"] = "cancelled"
            payload["stage"] = "cancelled"
            payload["message"] = f"{pipeline_name.upper()} analysis cancelled"
            payload["updated_at"] = now
            payload["completed_at"] = now
            payload["can_use"] = False
            state[pipeline_name] = payload

    update_pipeline_state_file(PIPELINE_STATE_FILE, mark_cancelled)

    stopped = []
    with _PROCESS_LOCK:
        processes = {
            pipeline_name: _RUNNING_PROCESSES.get(pipeline_name)
            for pipeline_name in pipelines
        }

    for pipeline_name, process in processes.items():
        if process is not None and process.poll() is None:
            _terminate_process(process)
            stopped.append(pipeline_name)

    return jsonify({"ok": True, "message": "Pipelines cancelled", "terminated": stopped}), 200
