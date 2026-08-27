#!/usr/bin/env python3
"""Evaluate the trained F2 model on the locally held-out test split.

Runs LOCALLY on this PC after you download the trained model from the cluster.
Needs only torch + Pillow (no timm) because the exported model is self-contained.

    python evaluate_testset.py \
        --model data/f2_dataset/f2_image_model.pt \
        --labels data/f2_dataset/f2_labels.json \
        --test data/f2_dataset/test.jsonl \
        --data-root data/f2_dataset
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

import torch
from PIL import Image


def preprocess(path: Path, size: int = 224) -> torch.Tensor:
    """Resize shorter side to 256, center-crop `size`, scale to [0,1] CHW.

    Must match train_f2.py's eval transform and classifier._preprocess_image.
    """
    resize_to = int(size * 256 / 224)
    with Image.open(path) as im:
        image = im.convert("RGB")
        w, h = image.size
        if w <= h:
            new = (resize_to, max(1, round(h * resize_to / w)))
        else:
            new = (max(1, round(w * resize_to / h)), resize_to)
        image = image.resize(new, Image.BICUBIC)
        w, h = image.size
        left, top = (w - size) // 2, (h - size) // 2
        image = image.crop((left, top, left + size, top + size))
        tensor = torch.frombuffer(image.tobytes(), dtype=torch.uint8).float() / 255.0
        return tensor.view(size, size, 3).permute(2, 0, 1).contiguous()


def main() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description="Evaluate F2 model on held-out test set")
    parser.add_argument("--model", type=Path, default=repo_root / "data" / "f2_dataset" / "f2_image_model.pt")
    parser.add_argument("--labels", type=Path, default=repo_root / "data" / "f2_dataset" / "f2_labels.json")
    parser.add_argument("--test", type=Path, default=repo_root / "data" / "f2_dataset" / "test.jsonl")
    parser.add_argument("--data-root", type=Path, default=repo_root / "data" / "f2_dataset")
    parser.add_argument("--img-size", type=int, default=224)
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()

    labels = json.loads(args.labels.read_text(encoding="utf-8"))
    maps = {k: {n: i for i, n in enumerate(labels[k])} for k in ("styles", "genres", "artists")}

    model = torch.jit.load(str(args.model), map_location="cpu")
    model.eval()

    rows = [json.loads(l) for l in args.test.read_text(encoding="utf-8").splitlines() if l.strip()]
    print(f"Evaluating {len(rows)} test images ...")

    correct = Counter()
    total = Counter()
    per_class_correct = {k: defaultdict(int) for k in ("style", "genre", "artist")}
    per_class_total = {k: defaultdict(int) for k in ("style", "genre", "artist")}

    batch, metas = [], []

    def flush():
        if not batch:
            return
        with torch.inference_mode():
            s, g, a = model(torch.stack(batch))
        preds = {"style": s.argmax(-1), "genre": g.argmax(-1), "artist": a.argmax(-1)}
        for i, meta in enumerate(metas):
            for head, lab_key, lab_map in (("style", "style", maps["styles"]),
                                           ("genre", "genre", maps["genres"]),
                                           ("artist", "artist", maps["artists"])):
                truth = meta.get(lab_key)
                if truth is None or truth not in lab_map:
                    continue
                gt = lab_map[truth]
                ok = int(preds[head][i]) == gt
                correct[head] += ok
                total[head] += 1
                per_class_correct[head][truth] += ok
                per_class_total[head][truth] += 1
        batch.clear()
        metas.clear()

    for row in rows:
        path = args.data_root / row["image"]
        if not path.exists():
            continue
        batch.append(preprocess(path, args.img_size))
        metas.append(row)
        if len(batch) >= args.batch_size:
            flush()
    flush()

    print("\n=== Test accuracy (held-out, never seen in training) ===")
    for head in ("style", "genre", "artist"):
        if total[head]:
            print(f"  {head:7s}: {correct[head] / total[head]:.4f}  (n={total[head]})")

    print("\n=== Per-class artist accuracy ===")
    for name in sorted(per_class_total["artist"], key=lambda n: -per_class_total["artist"][n]):
        c, t = per_class_correct["artist"][name], per_class_total["artist"][name]
        print(f"  {name:30s} {c / t:.3f}  (n={t})")


if __name__ == "__main__":
    main()
