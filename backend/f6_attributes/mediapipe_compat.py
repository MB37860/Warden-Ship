"""Compatibility helpers for using MediaPipe in headless backend environments."""

from __future__ import annotations

import sys


def import_mediapipe():
    """Import MediaPipe without hanging on unused desktop-audio bindings.

    MediaPipe imports its Tasks audio package from the top-level module. On this
    backend host, importing ``sounddevice`` can block while probing PortAudio
    even though the F6 pipeline only needs pose and face-mesh solutions. Marking
    ``sounddevice`` as unavailable lets MediaPipe take its documented ImportError
    path for audio support while preserving the vision features we actually use.
    """

    sys.modules.setdefault("sounddevice", None)
    import mediapipe as mp

    return mp
