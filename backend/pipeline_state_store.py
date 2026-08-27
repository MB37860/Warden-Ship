"""Shared, process-safe helpers for pipeline progress state."""

from __future__ import annotations

import json
import os
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows fallback for local dev.
    fcntl = None


_THREAD_LOCK = threading.RLock()


@contextmanager
def _locked_state_file(state_file: Path):
    state_file.parent.mkdir(parents=True, exist_ok=True)
    lock_path = state_file.with_suffix(state_file.suffix + ".lock")

    with _THREAD_LOCK:
        with lock_path.open("a+", encoding="utf-8") as lock_handle:
            if fcntl is not None:
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                if fcntl is not None:
                    fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)


def _read_unlocked(state_file: Path) -> dict[str, Any]:
    if not state_file.exists():
        return {}

    try:
        with state_file.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _write_unlocked(state_file: Path, state: dict[str, Any]) -> None:
    tmp_path = state_file.with_name(
        f"{state_file.name}.{os.getpid()}.{threading.get_ident()}.tmp",
    )
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(state, handle)
    tmp_path.replace(state_file)


def read_pipeline_state_file(state_file: Path) -> dict[str, Any]:
    with _locked_state_file(state_file):
        return _read_unlocked(state_file)


def update_pipeline_state_file(
    state_file: Path,
    update: Callable[[dict[str, Any]], Any],
) -> Any:
    with _locked_state_file(state_file):
        state = _read_unlocked(state_file)
        result = update(state)
        _write_unlocked(state_file, state)
        return result


def write_pipeline_state(
    state_file: Path,
    pipeline_name: str,
    *,
    status: str = "running",
    progress: float = 0,
    stage: str = "queued",
    message: str = "",
    error: str | None = None,
    can_use: bool = False,
    extra: dict[str, Any] | None = None,
) -> None:
    now = time.time()

    def update(state: dict[str, Any]) -> None:
        previous = state.get(pipeline_name, {})
        previous_active = (
            previous.get("status") in {"running", "pending"}
            and previous.get("completed_at") is None
        )
        payload = {
            "status": status,
            "progress": max(0, min(100, int(round(progress)))),
            "stage": stage,
            "message": message,
            "error": error,
            "can_use": can_use,
            "started_at": previous.get("started_at") if previous_active else now,
            "updated_at": now,
        }
        if status in {"completed", "failed", "cancelled"}:
            payload["completed_at"] = now
        if extra:
            payload.update(extra)
        state[pipeline_name] = payload

    update_pipeline_state_file(state_file, update)
