#!/usr/bin/env python3
"""Zero-shot evaluation of the *pretrained* CLIP model on the held-out test set.

This evaluates the model that powers F1 (semantic search) and F5 (history map):
openai/clip-vit-base-patch32 -- the exact model in backend/api/clip_service.py.
Zero-shot accuracy on style/genre/artist is a fair baseline that quantifies how
much the fine-tuned F2 classifier gains over off-the-shelf CLIP, using the same
label spaces and the same held-out test split.

Each image is encoded once and scored against all three heads. Reports per-head
accuracy with 95% Wilson confidence intervals and writes a JSON report.

    .venv/bin/python docs/evaluation/clip_zeroshot_eval.py \
        --model openai/clip-vit-base-patch32 \
        --test data/f2_dataset/test.jsonl --data-root data/f2_dataset \
        --labels data/f2_dataset/f2_labels.json \
        --report docs/evaluation/clip_zeroshot_eval.json
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
import torch.nn.functional as F
from PIL import Image
from transformers import CLIPModel, CLIPProcessor


def wilson(correct: int, total: int, z: float = 1.96):
    if total == 0:
        return 0.0, 0.0, 0.0
    p = correct / total
    denom = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denom
    half = (z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))) / denom
    return p, max(0.0, centre - half), min(1.0, centre + half)


def _embeds(features, attr):
    if torch.is_tensor(features):
        return features
    for name in (attr, "pooler_output"):
        value = getattr(features, name, None)
        if torch.is_tensor(value):
            return value
    raise RuntimeError("CLIP returned an unsupported feature output")


def prompts_for(head: str, names: list[str]) -> list[str]:
    out = []
    for c in names:
        clean = c.replace("-", " ").strip()
        if head == "style":
            out.append(f"a painting in the {clean} style")
        elif head == "genre":
            low = clean.lower()
            out.append(f"a {low}" if "painting" in low else f"a {low} painting")
        else:  # artist
            out.append(f"a painting by {clean}")
    return out


@torch.no_grad()
def main() -> None:
    ap = argparse.ArgumentParser(description="Zero-shot CLIP eval on held-out test set")
    ap.add_argument("--model", default="openai/clip-vit-base-patch32")
    ap.add_argument("--test", type=Path, required=True)
    ap.add_argument("--data-root", type=Path, required=True)
    ap.add_argument("--labels", type=Path, required=True)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--sample", type=int, default=0, help="0 = full test set")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--report", type=Path, default=None)
    ap.add_argument("--tag", default="clip-zeroshot-vitb32")
    args = ap.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    labels = json.loads(args.labels.read_text(encoding="utf-8"))
    heads = {"style": labels["styles"], "genre": labels["genres"], "artist": labels["artists"]}

    model = CLIPModel.from_pretrained(args.model).to(device).eval()
    processor = CLIPProcessor.from_pretrained(args.model)

    # Pre-embed the class-name prompts for every head once.
    text_feat, cmap = {}, {}
    for head, names in heads.items():
        tok = processor(text=prompts_for(head, names), return_tensors="pt",
                        padding=True, truncation=True).to(device)
        text_feat[head] = F.normalize(_embeds(model.get_text_features(**tok), "text_embeds"), dim=-1)
        cmap[head] = {c: i for i, c in enumerate(names)}

    rows = [json.loads(l) for l in args.test.read_text(encoding="utf-8").splitlines() if l.strip()]
    rows = [r for r in rows if (args.data_root / r["image"]).exists()]
    full_n = len(rows)
    if args.sample and args.sample < full_n:
        random.Random(args.seed).shuffle(rows)
        rows = rows[: args.sample]
    print(f"[{args.tag}] model={args.model}  evaluating {len(rows)}/{full_n} images on {device}", flush=True)

    correct, total = Counter(), Counter()
    per_class_correct = {k: defaultdict(int) for k in heads}
    per_class_total = {k: defaultdict(int) for k in heads}

    batch, metas = [], []
    started = time.time()
    done = 0

    def flush():
        nonlocal done
        if not batch:
            return
        enc = processor(images=batch, return_tensors="pt", padding=True).to(device)
        feat = F.normalize(_embeds(model.get_image_features(pixel_values=enc["pixel_values"]), "image_embeds"), dim=-1)
        for head in heads:
            pred = (feat @ text_feat[head].t()).argmax(dim=-1)
            for i, meta in enumerate(metas):
                truth = meta.get(head)
                if truth is None or truth not in cmap[head]:
                    continue
                ok = int(pred[i].item()) == cmap[head][truth]
                correct[head] += ok
                total[head] += 1
                per_class_correct[head][truth] += ok
                per_class_total[head][truth] += 1
        done += len(batch)
        batch.clear()
        metas.clear()
        rate = done / max(1e-9, time.time() - started)
        print(f"    {done}/{len(rows)}  ({rate:.1f} img/s)", flush=True)

    for row in rows:
        with Image.open(args.data_root / row["image"]) as im:
            batch.append(im.convert("RGB").copy())
        metas.append(row)
        if len(batch) >= args.batch_size:
            flush()
    flush()

    report = {"tag": args.tag, "model": args.model, "evaluated": len(rows),
              "available": full_n, "sample": args.sample or None, "seed": args.seed,
              "elapsed_s": round(time.time() - started, 1), "heads": {}, "artist_per_class": {}}

    print(f"\n=== [{args.tag}] zero-shot test accuracy (95% Wilson CI) ===")
    for head in ("style", "genre", "artist"):
        if total[head]:
            p, lo, hi = wilson(correct[head], total[head])
            report["heads"][head] = {"acc": p, "ci95": [lo, hi], "n": total[head]}
            print(f"  {head:7s}: {p:.4f}  [{lo:.4f}, {hi:.4f}]  (n={total[head]})")
    if report["heads"]:
        report["mean_acc"] = sum(h["acc"] for h in report["heads"].values()) / len(report["heads"])
        print(f"  mean   : {report['mean_acc']:.4f}")

    for name in sorted(per_class_total["artist"], key=lambda n: -per_class_total["artist"][n]):
        c, t = per_class_correct["artist"][name], per_class_total["artist"][name]
        report["artist_per_class"][name] = {"acc": c / t, "n": t}

    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nwrote {args.report}")


if __name__ == "__main__":
    main()
