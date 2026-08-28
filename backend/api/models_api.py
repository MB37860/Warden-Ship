"""Availability and download of the trained models the app fetches from the Hub.

The three large artifacts cannot ride inside the installer, so on a fresh
install the app runs its weaker fallbacks until they are pulled. That is a
legitimate state, not an error - but it has to be visible, and the pull has to
be something the user starts on purpose rather than a 2.1 GB stall in the
middle of their first search.
"""

from __future__ import annotations

import threading

from flask import Blueprint, jsonify, request

from backend.api import model_assets

models_api_bp = Blueprint("models_api", __name__)

# One download at a time, so two clicks cannot start two 1.2 GB pulls.
_DOWNLOAD_LOCK = threading.Lock()
_DOWNLOADING: set[str] = set()


@models_api_bp.route("/", methods=["GET"])
def list_models():
    report = model_assets.status()
    for entry in report:
        entry["downloading"] = entry["key"] in _DOWNLOADING
    return jsonify(
        {
            "models": report,
            "ready": all(entry["ready"] for entry in report),
            "pending_megabytes": sum(
                entry["megabytes"] for entry in report if not entry["ready"]
            ),
        }
    )


@models_api_bp.route("/download", methods=["POST"])
def download_models():
    payload = request.get_json(silent=True) or {}
    requested = payload.get("keys") or list(model_assets.ASSETS)
    keys = [key for key in requested if key in model_assets.ASSETS]
    if not keys:
        return jsonify({"ok": False, "error": "No known model keys requested"}), 400

    started, results = [], {}
    for key in keys:
        with _DOWNLOAD_LOCK:
            if key in _DOWNLOADING:
                results[key] = "already downloading"
                continue
            _DOWNLOADING.add(key)
        started.append(key)

    # Blocking here would hold the request open for minutes; the interface
    # polls GET / instead.
    def run() -> None:
        for key in started:
            try:
                model_assets.fetch(key)
            finally:
                with _DOWNLOAD_LOCK:
                    _DOWNLOADING.discard(key)

    if started:
        threading.Thread(target=run, name="model-download", daemon=True).start()
        for key in started:
            results[key] = "started"

    return jsonify({"ok": True, "models": results})
