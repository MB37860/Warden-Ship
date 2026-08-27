#!/usr/bin/env python3
"""Coverage evaluation of the off-the-shelf F6 detectors on art images.

YOLOv8, DeepFace and MediaPipe are pretrained on photographs and are *not*
trained by this project; WikiArt carries no object/emotion/pose ground truth, so
a classification-style "accuracy" cannot be computed. What we *can* measure
honestly is COVERAGE: how often each detector fires on stylised paintings, and
the distribution of what it reports. Thresholds mirror the live F6 pipeline.

    .venv/bin/python docs/evaluation/f6_coverage_eval.py \
        --test data/f2_dataset/test.jsonl --data-root data/f2_dataset \
        --sample 200 --report docs/evaluation/f6_coverage_eval.json
"""
from __future__ import annotations

import argparse
import json
import os
import random
import time
import warnings
from collections import Counter
from pathlib import Path

warnings.filterwarnings("ignore")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("GLOG_minloglevel", "3")

import numpy as np
from PIL import Image

YOLO_MODEL_ID = os.getenv("F6_YOLO_MODEL", "yolov8m.pt")
YOLO_MIN_CONF = 0.40          # F6_YOLO_MIN_CONFIDENCE
DEEPFACE_BACKEND = "retinaface"
MIN_FACE_CONF = 0.80          # dominant-emotion confidence (0-1)
MIN_POSE_RATIO = 0.08         # skeleton bbox / image area


def eval_yolo(paths):
    from ultralytics import YOLO
    model = YOLO(YOLO_MODEL_ID)
    with_obj = 0
    n_objs, max_confs, classes = [], [], Counter()
    for p in paths:
        res = model(str(p), verbose=False)[0]
        confs = [float(b.conf[0]) for b in res.boxes if float(b.conf[0]) >= YOLO_MIN_CONF]
        names = [res.names[int(b.cls[0])] for b in res.boxes if float(b.conf[0]) >= YOLO_MIN_CONF]
        if confs:
            with_obj += 1
            max_confs.append(max(confs))
        n_objs.append(len(confs))
        classes.update(names)
    n = len(paths)
    return {
        "n": n,
        "images_with_object_pct": round(100 * with_obj / n, 1),
        "mean_objects_per_image": round(float(np.mean(n_objs)), 2),
        "mean_top_confidence": round(float(np.mean(max_confs)), 3) if max_confs else None,
        "top_classes": classes.most_common(10),
    }


def eval_emotion(paths):
    from deepface import DeepFace
    with_face = 0
    dominant = Counter()
    for p in paths:
        try:
            results = DeepFace.analyze(img_path=str(p), actions=["emotion"],
                                       detector_backend=DEEPFACE_BACKEND,
                                       enforce_detection=False, silent=True)
        except Exception:
            continue
        if not isinstance(results, list):
            results = [results]
        best = None
        for r in results:
            emo = r.get("emotion", {})
            conf = (max(emo.values()) / 100.0) if emo else 0.0
            if conf >= MIN_FACE_CONF and (best is None or conf > best[0]):
                best = (conf, r.get("dominant_emotion", "?"))
        if best:
            with_face += 1
            dominant[best[1]] += 1
    n = len(paths)
    return {
        "n": n,
        "images_with_face_pct": round(100 * with_face / n, 1),
        "dominant_emotion_hist": dominant.most_common(),
    }


def eval_pose(paths):
    import mediapipe as mp
    pose = mp.solutions.pose.Pose(static_image_mode=True, model_complexity=1,
                                  min_detection_confidence=0.5)
    detected = valid = 0
    ratios = []
    for p in paths:
        img = np.array(Image.open(p).convert("RGB"))
        h, w = img.shape[:2]
        res = pose.process(img)
        if not res.pose_landmarks:
            continue
        detected += 1
        xs = [lm.x for lm in res.pose_landmarks.landmark]
        ys = [lm.y for lm in res.pose_landmarks.landmark]
        ratio = (max(xs) - min(xs)) * (max(ys) - min(ys))  # normalised bbox area
        ratios.append(ratio)
        if ratio >= MIN_POSE_RATIO:
            valid += 1
    pose.close()
    n = len(paths)
    return {
        "n": n,
        "images_with_pose_pct": round(100 * detected / n, 1),
        "images_with_valid_pose_pct": round(100 * valid / n, 1),
        "mean_pose_bbox_ratio": round(float(np.mean(ratios)), 3) if ratios else None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", type=Path, required=True)
    ap.add_argument("--data-root", type=Path, required=True)
    ap.add_argument("--sample", type=int, default=200)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--report", type=Path, default=None)
    ap.add_argument("--skip", nargs="*", default=[], help="any of: yolo emotion pose")
    args = ap.parse_args()

    rows = [json.loads(l) for l in args.test.read_text().splitlines() if l.strip()]
    rows = [r for r in rows if (args.data_root / r["image"]).exists()]
    random.Random(args.seed).shuffle(rows)
    rows = rows[: args.sample]
    paths = [args.data_root / r["image"] for r in rows]
    print(f"F6 coverage on {len(paths)} sampled test images (seed={args.seed})", flush=True)

    report = {"sample": len(paths), "seed": args.seed}
    for name, fn in (("yolo", eval_yolo), ("emotion", eval_emotion), ("pose", eval_pose)):
        if name in args.skip:
            continue
        t = time.time()
        try:
            report[name] = fn(paths)
            report[name]["elapsed_s"] = round(time.time() - t, 1)
            print(f"[{name}] {json.dumps(report[name])}", flush=True)
        except Exception as exc:
            report[name] = {"error": str(exc)}
            print(f"[{name}] ERROR {exc}", flush=True)

    if args.report:
        args.report.write_text(json.dumps(report, indent=2))
        print(f"wrote {args.report}")


if __name__ == "__main__":
    main()
