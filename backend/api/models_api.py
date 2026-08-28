"""Availability and download of the trained models the app fetches from the Hub.

The three large artifacts cannot ride inside the installer, so on a fresh
install the app runs its weaker fallbacks until they are pulled. That is a
legitimate state, not an error - but it has to be visible, and the pull has to
be something the user starts on purpose rather than a 2.1 GB stall in the
middle of their first search.
"""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from backend.api import model_assets

models_api_bp = Blueprint("models_api", __name__)


@models_api_bp.route("/", methods=["GET"])
def list_models():
    report = model_assets.status()
    for entry in report:
        entry["downloading"] = entry["source"] == "downloading"
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

    # Returns immediately; the interface polls GET / for the outcome. Holding
    # the request open for a 1.2 GB pull would just time out.
    results = {}
    for key in keys:
        if model_assets.is_available(key):
            results[key] = "already present"
        elif model_assets.is_downloading(key):
            results[key] = "already downloading"
        else:
            model_assets.fetch_in_background(key)
            results[key] = "started"

    return jsonify({"ok": True, "models": results})
