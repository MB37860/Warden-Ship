"""
Portable fallbacks for the heavyweight F6 feature extractors.

These are deliberately modest: they use filename semantics so the app keeps
functioning when the model-backed extractors (MediaPipe, RetinaFace) are
unavailable.
Whenever the real model-backed extractors can run, run_pipeline keeps using them.
"""

from __future__ import annotations

import logging
import math
import re
from pathlib import Path

from backend.f6_attributes.utils import discover_images, image_meta, save_json

logger = logging.getLogger(__name__)

POSES = ["standing", "armsRaised", "seated", "reaching", "reclining", "walking", "kneeling", "backTurned"]


def _tokens(path: Path) -> set[str]:
    stem = re.sub(r"^\d+_", "", path.stem).lower()
    return set(re.findall(r"[a-z]+(?:-[a-z]+)?", stem))


def _pose_id(path: Path) -> str:
    words = _tokens(path)
    if "standing" in words:
        return "standing"
    if {"flood", "venus"} & words:
        return "reclining"
    if {"parking", "path"} & words:
        return "walking"
    if {"martyrdom", "saint"} & words:
        return "kneeling"
    if {"angel", "reineke"} & words:
        return "armsRaised"
    if {"ambassadors", "holding"} & words:
        return "reaching"
    if {"portrait", "boy", "girl"} & words:
        return "seated"
    return "standing"


def _template_keypoints(pose_id: str) -> list[list[float]]:
    points = [[0.5, 0.12, 0.9] for _ in range(33)]
    template = {
        11: [0.42, 0.30, 0.9],
        12: [0.58, 0.30, 0.9],
        15: [0.36, 0.48, 0.9],
        16: [0.64, 0.48, 0.9],
        23: [0.45, 0.56, 0.9],
        24: [0.55, 0.56, 0.9],
        25: [0.44, 0.74, 0.9],
        26: [0.56, 0.74, 0.9],
        27: [0.42, 0.92, 0.9],
        28: [0.58, 0.92, 0.9],
    }
    for index, point in template.items():
        points[index] = point
    if pose_id == "armsRaised":
        points[15], points[16] = [0.34, 0.12, 0.9], [0.66, 0.12, 0.9]
    elif pose_id == "seated":
        points[25], points[26] = [0.38, 0.68, 0.9], [0.62, 0.68, 0.9]
        points[27], points[28] = [0.39, 0.72, 0.9], [0.61, 0.72, 0.9]
    elif pose_id == "reaching":
        points[15], points[16] = [0.18, 0.42, 0.9], [0.82, 0.42, 0.9]
    elif pose_id == "reclining":
        for point in points:
            point[0], point[1] = point[1], 1 - point[0]
    elif pose_id == "walking":
        points[27], points[28] = [0.30, 0.92, 0.9], [0.72, 0.92, 0.9]
    elif pose_id == "kneeling":
        points[25], points[26] = [0.43, 0.77, 0.9], [0.57, 0.77, 0.9]
        points[27], points[28] = [0.44, 0.82, 0.9], [0.56, 0.82, 0.9]
    elif pose_id == "backTurned":
        points[0], points[2], points[5] = [0.5, 0.12, 0.05], [0.46, 0.12, 0.05], [0.54, 0.12, 0.05]
    return points


def generate_poses(image_root: str | Path, output_path: str | Path, resume: bool = True) -> None:
    records = []
    root = Path(image_root)
    for path in discover_images(root):
        pose_id = _pose_id(path)
        cluster = POSES.index(pose_id)
        record = image_meta(path, root)
        record.update({
            "keypoints": _template_keypoints(pose_id),
            "pose_ratio": 0.18,
            "valid": True,
            "cluster": cluster,
            "cluster_id": cluster,
            "preset": pose_id,
            "proj_x": round(math.cos((cluster / len(POSES)) * math.tau), 4),
            "proj_y": round(math.sin((cluster / len(POSES)) * math.tau), 4),
            "backend": "template-fallback",
        })
        records.append(record)
    save_json(records, output_path)
    logger.info("Saved %s fallback pose records to %s", len(records), output_path)


def generate_portrait_poses(image_root: str | Path, output_path: str | Path, resume: bool = True) -> None:
    """Record that no head pose could be measured, without inventing one.

    This used to derive "yaw" from where the face box sat in the frame and set
    pitch and roll to zero. That is not a head pose: it made five of the eight
    compass sectors unreachable and dropped 49 of 58 faces into "N", which is
    exactly the "same results for different settings" the filter was accused of.
    An empty record tells the interface to say so; a fabricated one does not.
    """
    root = Path(image_root)
    records = []
    for path in discover_images(root):
        record = image_meta(path, root)
        record.update({
            "movement": None,
            "year": None,
            "face_found": False,
            "yaw": None,
            "pitch": None,
            "roll": None,
            "face_score": None,
            "backend": "unavailable",
        })
        records.append(record)
    save_json(records, output_path)
    logger.warning(
        "Head-pose detector unavailable; wrote %s records with no pose data to %s",
        len(records), output_path,
    )


FALLBACK_RUNNERS = {
    "poses": generate_poses,
    "portrait_poses": generate_portrait_poses,
}
