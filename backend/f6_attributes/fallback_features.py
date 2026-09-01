"""
Portable fallbacks for the heavyweight F6 feature extractors.

These are deliberately modest: they use filename semantics so the app keeps
functioning when the model-backed extractors (MediaPipe, RetinaFace) are
unavailable.
Whenever the real model-backed extractors can run, run_pipeline keeps using them.
"""

from __future__ import annotations

import logging
from pathlib import Path

from backend.f6_attributes.utils import discover_images, image_meta, save_json

logger = logging.getLogger(__name__)

def generate_poses(image_root: str | Path, output_path: str | Path, resume: bool = True) -> None:
    """Record that no body pose could be measured, without inventing one.

    This used to guess a pose from words in the filename and write a hand-built
    template skeleton with ``valid: True``. Every painting whose name matched no
    keyword - which is nearly all of them - got the "standing" template, whose
    wrist span (0.28) is wider than its shoulder span (0.16) by more than the
    1.2 margin the interface uses, so all of them were labelled "Arms Out". On a
    100-image test set that put 98 paintings in a single tile, most of them
    containing no person at all.

    Same reasoning as generate_portrait_poses below, and the same reasoning the
    F5 year head applies to dates: an empty record tells the interface to say
    so, a fabricated one lies to it.
    """
    root = Path(image_root)
    records = []
    for path in discover_images(root):
        record = image_meta(path, root)
        record.update({
            "keypoints": [],
            "pose_ratio": 0.0,
            "valid": False,
            "cluster": -1,
            "proj_x": 0.0,
            "proj_y": 0.0,
            "backend": "unavailable",
        })
        records.append(record)
    save_json(records, output_path)
    logger.warning(
        "Body-pose detector unavailable; wrote %s records with no pose data to %s",
        len(records), output_path,
    )


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
