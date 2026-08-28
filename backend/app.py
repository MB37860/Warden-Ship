"""Flask application factory-free entry point for the Warden Ship backend.

Run it directly for development (``python backend/app.py``); the desktop shell
uses :mod:`backend.electron_server` instead, which serves without the reloader.
"""

import os
import sys
from pathlib import Path

from flask import Flask, jsonify
from flask_cors import CORS

# Running this file as a script leaves the repo root - the parent of the
# ``backend`` package - off sys.path, so the package-absolute imports below
# would fail. Put it there first.
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

try:
    from dotenv import load_dotenv

    load_dotenv(REPO_ROOT / ".env")
except ImportError:
    pass

from backend.api.database_api import database_api_bp
from backend.api.f2_api import f2_api_bp
from backend.api.f6_api import f6_api_bp
from backend.api.image_api import image_api_bp
from backend.api.models_api import models_api_bp
from backend.api.pipeline_api import pipeline_api_bp
from backend.f5_history_map.f5_api import f5_api_bp

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})


app.register_blueprint(image_api_bp, url_prefix="/api/image")
app.register_blueprint(database_api_bp, url_prefix="/api/database")
app.register_blueprint(f2_api_bp, url_prefix="/api/f2")
app.register_blueprint(f5_api_bp, url_prefix="/api/f5")
app.register_blueprint(f6_api_bp, url_prefix="/api/f6")
app.register_blueprint(pipeline_api_bp, url_prefix="/api/pipeline")
app.register_blueprint(models_api_bp, url_prefix="/api/models")

@app.route("/")
def index():
    return "Warden Ship backend is running."


@app.route("/api/health")
def health():
    """Identify this process.

    The desktop shell reuses an already-running backend instead of spawning a
    second one; it must be able to tell OUR backend from any other program that
    happens to hold the port, because a stranger would be talking to a
    different database.
    """
    return jsonify({
        "app": "warden-ship",
        "ok": True,
        "mongo_uri": os.getenv("MONGO_URI", "mongodb://localhost:27017/"),
        "data_dir": os.getenv("WARDEN_SHIP_DATA_DIR", ""),
    })

if __name__ == '__main__':
    app.run(
        debug=True,
        host=os.getenv("FLASK_HOST", "0.0.0.0"),
        port=int(os.getenv("FLASK_PORT", "5000")),
    )
