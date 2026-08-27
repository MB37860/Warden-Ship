#!/usr/bin/env python3
"""Independent local evaluation of an F2 model on the held-out test split.

Extends evaluate_testset.py with:
  * reproducible random sub-sampling (--sample N --seed S) so heavyweight
    models (ViT-L/336) can be scored on CPU in reasonable time,
  * Wilson 95% confidence intervals on every accuracy (honest about the
    sampling error a sub-sample introduces),
  * a machine-readable JSON report written to --report.

Usage:
    python evaluate_local.py \
        --model  data/f2_dataset_hires/f2_image_model.pt \
        --labels data/f2_dataset_hires/f2_labels.json \
        --test   data/f2_dataset_hires/test.jsonl \
        --data-root data/f2_dataset_hires \
        --img-size 336 --sample 1500 --seed 42 \
        --report docs/evaluation/f2_hires_eval.json
"""

from __future__ import annotations

import argparse
import json
import math
import random
import time
from collections import Counter, defaultdict
from pathlib import Path

import torch
from PIL import Image


def preprocess(path: Path, size: int = 224) -> torch.Tensor:
    """Resize shorter side to 256/224*size, center-crop, scale to [0,1] CHW.

    Matches train_f2.py eval transform and classifier._preprocess_image.
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
        buf = bytearray(image.tobytes())
        tensor = torch.frombuffer(buf, dtype=torch.uint8).float() / 255.0
        return tensor.view(size, size, 3).permute(2, 0, 1).contiguous()


def wilson(correct: int, total: int, z: float = 1.96) -> tuple[float, float, float]:
    """Return (point estimate, lo, hi) Wilson score interval for a proportion."""
    if total == 0:
        return 0.0, 0.0, 0.0
    p = correct / total
    denom = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denom
    half = (z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))) / denom
    return p, max(0.0, centre - half), min(1.0, centre + half)


def main() -> None:
    parser = argparse.ArgumentParser(description="Independent local F2 evaluation")
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--test", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--img-size", type=int, default=224)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--sample", type=int, default=0, help="0 = full test set")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--report", type=Path, default=None)
    parser.add_argument("--tag", type=str, default="model")
    parser.add_argument("--threads", type=int, default=0, help="0 = torch default")
    args = parser.parse_args()

    if args.threads:
        torch.set_num_threads(args.threads)

    labels = json.loads(args.labels.read_text(encoding="utf-8"))
    maps = {k: {n: i for i, n in enumerate(labels[k])} for k in ("styles", "genres", "artists")}

    model = torch.jit.load(str(args.model), map_location="cpu")
    model.eval()

    rows = [json.loads(l) for l in args.test.read_text(encoding="utf-8").splitlines() if l.strip()]
    rows = [r for r in rows if (args.data_root / r["image"]).exists()]
    full_n = len(rows)
    if args.sample and args.sample < full_n:
        random.Random(args.seed).shuffle(rows)
        rows = rows[: args.sample]
    print(f"[{args.tag}] evaluating {len(rows)} of {full_n} available test images "
          f"(sample={args.sample or 'full'}, seed={args.seed}) ...", flush=True)

    correct, total = Counter(), Counter()
    per_class_correct = {k: defaultdict(int) for k in ("style", "genre", "artist")}
    per_class_total = {k: defaultdict(int) for k in ("style", "genre", "artist")}
    # which class each artist error landed on, for the art-historical error analysis
    artist_confusion = Counter()

    batch, metas = [], []
    started = time.time()
    done = 0

    def flush():
        nonlocal done
        if not batch:
            return
        with torch.inference_mode():
            s, g, a = model(torch.stack(batch))
        preds = {"style": s.argmax(-1), "genre": g.argmax(-1), "artist": a.argmax(-1)}
        for i, meta in enumerate(metas):
            for head, lab_map in (("style", maps["styles"]),
                                  ("genre", maps["genres"]),
                                  ("artist", maps["artists"])):
                truth = meta.get(head)
                if truth is None or truth not in lab_map:
                    continue
                ok = int(preds[head][i]) == lab_map[truth]
                correct[head] += ok
                total[head] += 1
                per_class_correct[head][truth] += ok
                per_class_total[head][truth] += 1
                if head == "artist" and not ok:
                    artist_confusion[(truth, labels["artists"][int(preds[head][i])])] += 1
        done += len(batch)
        batch.clear()
        metas.clear()
        rate = done / max(1e-9, time.time() - started)
        print(f"    {done}/{len(rows)}  ({rate:.1f} img/s)", flush=True)

    for row in rows:
        batch.append(preprocess(args.data_root / row["image"], args.img_size))
        metas.append(row)
        if len(batch) >= args.batch_size:
            flush()
    flush()

    report = {"tag": args.tag, "model": str(args.model), "img_size": args.img_size,
              "evaluated": len(rows), "available": full_n,
              "sample": args.sample or None, "seed": args.seed,
              "elapsed_s": round(time.time() - started, 1), "heads": {}, "artist_per_class": {},
              "artist_confusion": []}

    print(f"\n=== [{args.tag}] held-out test accuracy (95% Wilson CI) ===")
    for head in ("style", "genre", "artist"):
        if total[head]:
            p, lo, hi = wilson(correct[head], total[head])
            report["heads"][head] = {"acc": p, "ci95": [lo, hi], "n": total[head]}
            print(f"  {head:7s}: {p:.4f}  [{lo:.4f}, {hi:.4f}]  (n={total[head]})")
    if report["heads"]:
        report["mean_acc"] = sum(h["acc"] for h in report["heads"].values()) / len(report["heads"])
        print(f"  mean   : {report['mean_acc']:.4f}")

    print("\n=== per-class artist accuracy ===")
    for name in sorted(per_class_total["artist"], key=lambda n: -per_class_total["artist"][n]):
        c, t = per_class_correct["artist"][name], per_class_total["artist"][name]
        report["artist_per_class"][name] = {"acc": c / t, "n": t}
        print(f"  {name:30s} {c / t:.3f}  (n={t})")

    print("\n=== artist confusions (true -> predicted) ===")
    for (truth, pred), count in artist_confusion.most_common():
        report["artist_confusion"].append({"true": truth, "pred": pred, "count": count})
        print(f"  {truth:30s} -> {pred:30s} {count}")

    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nwrote {args.report}")


if __name__ == "__main__":
    main()
