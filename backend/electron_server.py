"""Entry point used by the Electron desktop shell to run the Flask backend.

Unlike ``app.py`` (which runs with ``debug=True`` and the auto-reloader, forking
an extra worker process), this launcher runs a single, reloader-free server
bound to localhost so the Electron main process can manage exactly one child
process and shut it down cleanly.

Online model/font downloads are intentionally left untouched: the backend still
fetches CLIP weights and Google Fonts over the network on
first use, per project decision.

Run from the project root:  ``python -m backend.electron_server``
"""

from __future__ import annotations

import os

from backend import paths
from backend.app import app


def main() -> None:
    # In a packaged build the code sits on a read-only mount; make sure the
    # writable tree Electron pointed us at exists before serving.
    paths.ensure_writable_dirs()
    host = os.getenv("FLASK_HOST", "127.0.0.1")
    port = int(os.getenv("FLASK_PORT", os.getenv("PORT", "5000")))
    app.run(host=host, port=port, debug=False, use_reloader=False, threaded=True)


if __name__ == "__main__":
    main()
