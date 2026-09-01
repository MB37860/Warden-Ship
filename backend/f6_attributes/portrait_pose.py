"""
Feature: Portrait Pose Analysis  (new — from [A1])
===================================================
Computes yaw, pitch and roll for portrait paintings.  The carved head in the F6
scene turns the yaw into one of five compass sectors, from left profile to right.

Three backends, selected by HEAD_POSE_BACKEND:
    1. "retinaface" (default) — RetinaFace detection + geometry over its five
       landmarks, via the `retina-face` package. FaceMesh is trained on
       photographs and misses most painted faces (see the note above
       _retinaface_head_pose), which is why this is the default.
    2. "mediapipe"            — MediaPipe FaceMesh + solvePnP (no extra download).
    3. "dnn"                  — a lightweight ONNX regression model.
       Also set HEAD_POSE_MODEL_PATH=/path/to/model.onnx

Output schema per painting:
{
  "id":          "...",
  "path":        "...",
  "movement":    "Impressionism",   # derived from folder structure (optional)
  "year":        1882,              # derived from metadata/filename (optional)
  "face_found":  true,
  "yaw":         -12.4,    # degrees; positive = face turned right
  "pitch":        3.1,     # degrees; positive = face tilted up
  "roll":        -2.7,     # degrees; positive = face tilted clockwise
}

The movement and year fields are populated if the image path follows the WikiArt
directory convention:  <root>/<movement>/<artist>/<year>_<title>.jpg
If not, they are set to null and can be populated from an external metadata JSON.
"""

from __future__ import annotations

import logging
import math
import os
import re
from pathlib import Path

# See the note in run_pipeline.py: Keras 3 breaks retina-face's graph
# construction. Set here too, for direct/CLI use of this module.
os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")

import cv2
import numpy as np
from tqdm import tqdm

from backend.f6_attributes.mediapipe_compat import import_mediapipe
from backend.f6_attributes.utils import discover_images, image_meta, load_json, save_json

logger = logging.getLogger(__name__)

HEAD_POSE_BACKEND   = os.getenv("HEAD_POSE_BACKEND", "retinaface")  # "retinaface" | "mediapipe" | "dnn"
HEAD_POSE_MODEL_PATH = os.getenv("HEAD_POSE_MODEL_PATH", "")


# ---------------------------------------------------------------------------
# Metadata helpers
# ---------------------------------------------------------------------------

def _extract_movement_and_year(path: Path, root: Path) -> tuple[str | None, int | None]:
    """
    Try to derive movement and year from path.
    WikiArt layout: <root>/<movement>/<artist>/<YYYY>_<title>.ext
    """
    parts = path.relative_to(root).parts
    movement = parts[0] if len(parts) >= 2 else None

    year = None
    stem = path.stem
    m = re.match(r"(\d{4})", stem)
    if m:
        year = int(m.group(1))

    return movement, year


# ---------------------------------------------------------------------------
# RetinaFace head-pose backend (default)
# ---------------------------------------------------------------------------

# FaceMesh is trained on photographs and misses most painted faces: measured on
# the 46 figure paintings of the 100-image test set it finds 14 (30%), against 35
# (76%) for RetinaFace, which the pipeline installs directly (retina-face).
# RetinaFace returns only five landmarks, so instead of solvePnP over a 6-point
# 3-D model we read the two angles those five points determine well.

# Projected forward offset of the nose tip from the inter-ocular line, as a
# fraction of the inter-ocular distance, on a frontal face. Rotating the head by
# yaw moves the nose sideways by nose_depth*sin(yaw) while the eye separation
# foreshortens by cos(yaw), so the observed ratio is nose_depth*tan(yaw).
_NOSE_DEPTH_RATIO = 0.6

_MIN_FACE_SCORE = 0.85

# This is a portrait instrument, so the head it measures has to be the head the
# painting is about. Without a size floor a 15-pixel peasant in a landscape, or
# one face among ten in a crowd scene, decided the whole painting's head pose.
#
# Size alone cannot make that call, though: a full-length portrait has a small
# face and is still a portrait. Measured across the test set, paintings with a
# single face fall into two clear groups - real portraits down to 0.74% of the
# canvas, then a gap, then figures in landscapes at 0.19% and below. A lone face
# therefore only has to clear the gap, while a face competing with others in a
# crowd scene has to be big enough to be the obvious subject.
_MIN_FACE_AREA_SHARE = 0.005
_MIN_CROWDED_FACE_AREA_SHARE = 0.01


def _retinaface_head_pose(img_bgr: np.ndarray) -> tuple[float, float | None, float, float, float] | None:
    """Estimate (yaw, pitch, roll, score) from RetinaFace's five landmarks.

    pitch is returned as None on purpose. Five points fix the eye line and the
    nose offset, which give yaw and roll directly, but they pin the vertical
    rotation only through face proportions that vary more between painters than
    between poses. Reporting a number we cannot defend is what made the previous
    version of this feature useless, so the field stays empty instead.
    """
    try:
        from retinaface import RetinaFace
    except ImportError:
        raise RuntimeError("retinaface is required. pip install retina-face")

    faces = RetinaFace.detect_faces(img_bgr)
    if not isinstance(faces, dict) or not faces:
        return None

    def _area(entry: dict) -> float:
        x1, y1, x2, y2 = entry.get("facial_area", (0, 0, 0, 0))
        return float(max(x2 - x1, 0) * max(y2 - y1, 0))

    # The biggest face, not the most confident one: in a portrait with a servant
    # in the background the sitter is the subject even when the smaller face
    # scores higher.
    face = max(faces.values(), key=_area)
    score = float(face.get("score", 0.0))
    if score < _MIN_FACE_SCORE:
        return None

    height, width = img_bgr.shape[:2]
    canvas = float(height * width)
    share = _area(face) / canvas if canvas else 0.0
    floor = _MIN_FACE_AREA_SHARE if len(faces) == 1 else _MIN_CROWDED_FACE_AREA_SHARE
    if share < floor:
        return None

    marks = face.get("landmarks") or {}
    try:
        right_eye = np.asarray(marks["right_eye"], dtype=np.float64)
        left_eye = np.asarray(marks["left_eye"], dtype=np.float64)
        nose = np.asarray(marks["nose"], dtype=np.float64)
    except (KeyError, TypeError, ValueError):
        return None

    # RetinaFace names landmarks from the sitter's point of view, so "right_eye"
    # is the left-hand one in the image.
    eye_axis = left_eye - right_eye
    eye_distance = float(np.linalg.norm(eye_axis))
    if eye_distance < 1.0:
        return None

    roll = math.degrees(math.atan2(float(eye_axis[1]), float(eye_axis[0])))

    eye_centre = (left_eye + right_eye) / 2.0
    unit_axis = eye_axis / eye_distance
    sideways = float(np.dot(nose - eye_centre, unit_axis)) / eye_distance
    yaw = math.degrees(math.atan(sideways / _NOSE_DEPTH_RATIO))

    return round(yaw, 2), None, round(roll, 2), round(score, 4), round(share, 4)


# ---------------------------------------------------------------------------
# MediaPipe head-pose backend
# ---------------------------------------------------------------------------

# 3-D model points for solvePnP (canonical face landmarks)
_MODEL_POINTS_3D = np.array([
    [0.0,    0.0,    0.0   ],   # Nose tip
    [0.0,   -330.0, -65.0 ],   # Chin
    [-225.0, 170.0, -135.0],   # Left eye left corner
    [225.0,  170.0, -135.0],   # Right eye right corner
    [-150.0,-150.0, -125.0],   # Left mouth corner
    [150.0, -150.0, -125.0],   # Right mouth corner
], dtype=np.float64)

# FaceMesh indices corresponding to the 6 model points above
_FACEMESH_IDX = [1, 152, 263, 33, 287, 57]


_FACE_MESH = None


def _get_face_mesh():
    """Build the MediaPipe FaceMesh once and reuse it for every image.

    Constructing a FaceMesh graph loads a TFLite model and spins up the whole
    calculator graph. Doing that per image (as the old code did) made step 6
    take minutes and flooded stderr with init logs. With static_image_mode=True
    every process() call is independent, so one shared instance is safe and far
    faster. refine_landmarks is off: the 6 head-pose landmarks we use never
    include the iris mesh, so the extra iris model is pure overhead.
    """
    global _FACE_MESH
    if _FACE_MESH is None:
        try:
            mp = import_mediapipe()
        except ImportError:
            raise RuntimeError("MediaPipe is required. pip install mediapipe")
        _FACE_MESH = mp.solutions.face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=1,
            refine_landmarks=False,
            min_detection_confidence=0.5,
        )
    return _FACE_MESH


def _mediapipe_head_pose(img_bgr: np.ndarray) -> tuple[float, float, float] | None:
    """
    Estimate yaw / pitch / roll using MediaPipe FaceMesh + solvePnP.
    Returns (yaw_deg, pitch_deg, roll_deg) or None if no face found.
    """
    face_mesh = _get_face_mesh()

    h, w = img_bgr.shape[:2]
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    # Landmarks are normalised (0..1), so a uniform downscale leaves the math
    # below unchanged while keeping detection fast on large painting scans.
    max_side = 1024
    if max(h, w) > max_side:
        scale = max_side / float(max(h, w))
        detect_img = cv2.resize(rgb, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    else:
        detect_img = rgb

    results = face_mesh.process(detect_img)

    if not results.multi_face_landmarks:
        return None

    lm = results.multi_face_landmarks[0].landmark
    image_points = np.array(
        [[lm[i].x * w, lm[i].y * h] for i in _FACEMESH_IDX],
        dtype=np.float64,
    )

    focal_length = w
    camera_matrix = np.array([
        [focal_length, 0,             w / 2],
        [0,            focal_length,  h / 2],
        [0,            0,             1    ],
    ], dtype=np.float64)
    dist_coeffs = np.zeros((4, 1))

    ok, rvec, _ = cv2.solvePnP(
        _MODEL_POINTS_3D, image_points, camera_matrix, dist_coeffs,
        flags=cv2.SOLVEPNP_ITERATIVE,
    )
    if not ok:
        return None

    rmat, _ = cv2.Rodrigues(rvec)

    # Decompose rotation matrix to Euler angles
    sy = math.sqrt(rmat[0, 0] ** 2 + rmat[1, 0] ** 2)
    singular = sy < 1e-6
    if not singular:
        roll  = math.atan2(rmat[2, 1], rmat[2, 2])
        pitch = math.atan2(-rmat[2, 0], sy)
        yaw   = math.atan2(rmat[1, 0], rmat[0, 0])
    else:
        roll  = math.atan2(-rmat[1, 2], rmat[1, 1])
        pitch = math.atan2(-rmat[2, 0], sy)
        yaw   = 0.0

    return (
        round(math.degrees(yaw),   2),
        round(math.degrees(pitch), 2),
        round(math.degrees(roll),  2),
    )


# ---------------------------------------------------------------------------
# DNN backend (ONNX)
# ---------------------------------------------------------------------------

def _dnn_head_pose(img_bgr: np.ndarray, model_path: str) -> tuple[float, float, float] | None:
    """
    Lightweight ONNX head-pose model (e.g. WHENet or 6DRepNet).
    Expects a single face-crop as 224×224 input; returns (yaw, pitch, roll).
    Requires onnxruntime: pip install onnxruntime
    """
    try:
        import onnxruntime as ort
    except ImportError:
        raise RuntimeError("onnxruntime is required for DNN backend. pip install onnxruntime")

    # We need a face crop first — use OpenCV's built-in DNN face detector
    blob = cv2.dnn.blobFromImage(img_bgr, 1.0, (300, 300), (104, 177, 123))
    detector = cv2.dnn.readNetFromCaffe(
        "deploy.prototxt",  # user must supply or use a different detection step
        "res10_300x300_ssd_iter_140000.caffemodel",
    )
    detector.setInput(blob)
    detections = detector.forward()

    h, w = img_bgr.shape[:2]
    face_crop = None
    for i in range(detections.shape[2]):
        conf = float(detections[0, 0, i, 2])
        if conf < 0.6:
            continue
        box = detections[0, 0, i, 3:7] * np.array([w, h, w, h])
        x1, y1, x2, y2 = box.astype(int)
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        face_crop = img_bgr[y1:y2, x1:x2]
        break

    if face_crop is None or face_crop.size == 0:
        return None

    face_input = cv2.resize(face_crop, (224, 224)).astype(np.float32)
    face_input = (face_input / 255.0 - 0.5) / 0.5
    face_input = face_input.transpose(2, 0, 1)[np.newaxis]  # (1, 3, 224, 224)

    session = ort.InferenceSession(model_path)
    inp_name = session.get_inputs()[0].name
    outputs = session.run(None, {inp_name: face_input})
    yaw, pitch, roll = outputs[0][0]

    return round(float(yaw), 2), round(float(pitch), 2), round(float(roll), 2)


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

def _estimate_pose(img_bgr: np.ndarray) -> tuple[float, float | None, float, float | None, float | None] | None:
    """Return (yaw, pitch, roll, score, face_share) for the configured backend."""
    if HEAD_POSE_BACKEND == "dnn" and HEAD_POSE_MODEL_PATH:
        result = _dnn_head_pose(img_bgr, HEAD_POSE_MODEL_PATH)
    elif HEAD_POSE_BACKEND == "mediapipe":
        result = _mediapipe_head_pose(img_bgr)
    else:
        return _retinaface_head_pose(img_bgr)
    if result is None:
        return None
    yaw, pitch, roll = result
    return yaw, pitch, roll, None, None


# ---------------------------------------------------------------------------
# Single image
# ---------------------------------------------------------------------------

def analyse_single(path: Path, root: Path) -> dict:
    img = cv2.imread(str(path))
    meta = image_meta(path, root)
    movement, year = _extract_movement_and_year(path, root)
    meta["movement"] = movement
    meta["year"]     = year

    absent = {
        "face_found": False,
        "yaw": None,
        "pitch": None,
        "roll": None,
        "face_score": None,
        "face_share": None,
        "backend": HEAD_POSE_BACKEND,
    }
    if img is None:
        meta.update(absent)
        return meta

    result = _estimate_pose(img)
    if result is None:
        meta.update(absent)
        return meta

    yaw, pitch, roll, score, share = result
    meta.update({
        "face_found": True,
        "yaw": yaw,
        "pitch": pitch,
        "roll": roll,
        "face_score": score,
        "face_share": share,
        "backend": HEAD_POSE_BACKEND,
    })
    return meta


# ---------------------------------------------------------------------------
# Batch pipeline
# ---------------------------------------------------------------------------

def run(image_root: str | Path, output_path: str | Path, resume: bool = True) -> None:
    root = Path(image_root)
    output_path = Path(output_path)
    images = discover_images(root)
    logger.info(f"Found {len(images)} images")

    existing: dict[str, dict] = {}
    if resume and output_path.exists():
        try:
            existing = {r["id"]: r for r in load_json(output_path)}
            logger.info(f"Resuming: {len(existing)} already processed")
        except Exception:
            pass

    results = list(existing.values())
    for path in tqdm(images, desc="Portrait pose"):
        img_id = str(path.relative_to(root))
        if img_id in existing:
            continue
        results.append(analyse_single(path, root))

    save_json(results, output_path)
    logger.info(f"Saved {len(results)} portrait pose records to {output_path}")


# ---------------------------------------------------------------------------
# Query helpers (serve-time)
# ---------------------------------------------------------------------------

def load_results(output_path: str | Path) -> list[dict]:
    return load_json(output_path)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    parser = argparse.ArgumentParser(description="Portrait pose analysis")
    parser.add_argument("image_root")
    parser.add_argument("output")
    parser.add_argument("--no-resume", action="store_true")
    args = parser.parse_args()

    run(args.image_root, args.output, resume=not args.no_resume)
