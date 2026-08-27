#!/usr/bin/env python3
"""Evaluate a (fine-tuned) CLIP on the held-out test set (LOCAL PC).

Reports zero-shot style/genre accuracy — a direct proxy for how well CLIP's
text/image spaces align on art, i.e. how good F1 typed search will be. Run it on
the baseline model and on the fine-tuned dir to measure the lift.

    # baseline
    python evaluate_clip.py --model openai/clip-vit-base-patch32 \
        --test data/f2_dataset/test.jsonl --data-root data/f2_dataset \
        --labels data/f2_dataset/labels.json --sample 2000
    # fine-tuned
    python evaluate_clip.py --model data/clip_art \
        --test data/f2_dataset/test.jsonl --data-root data/f2_dataset \
        --labels data/f2_dataset/labels.json --sample 2000
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import torch
import torch.nn.functional as F
from PIL import Image
from transformers import CLIPModel, CLIPProcessor


def _embeds(features, attr):
    if torch.is_tensor(features):
        return features
    for name in (attr, "pooler_output"):
        value = getattr(features, name, None)
        if torch.is_tensor(value):
            return value
    raise RuntimeError("CLIP returned an unsupported feature output")


@torch.no_grad()
def zero_shot(model, processor, rows, data_root, class_names, key, device, batch_size) -> tuple[float, int]:
    prompts = ([f"a painting in the {c} style" for c in class_names] if key == "style"
               else [f"a {c.lower()} painting" for c in class_names])
    tok = processor(text=prompts, return_tensors="pt", padding=True, truncation=True).to(device)
    text_feat = F.normalize(_embeds(model.get_text_features(**tok), "text_embeds"), dim=-1)
    cmap = {c: i for i, c in enumerate(class_names)}

    correct = total = 0
    batch, truths = [], []

    def flush():
        nonlocal correct, total
        if not batch:
            return
        enc = processor(images=batch, return_tensors="pt", padding=True).to(device)
        feat = F.normalize(_embeds(model.get_image_features(pixel_values=enc["pixel_values"]), "image_embeds"), dim=-1)
        pred = (feat @ text_feat.t()).argmax(dim=-1)
        for i, t in enumerate(truths):
            correct += int(pred[i].item() == cmap[t])
            total += 1
        batch.clear()
        truths.clear()

    for row in rows:
        truth = row.get(key)
        if truth not in cmap:
            continue
        with Image.open(data_root / row["image"]) as im:
            batch.append(im.convert("RGB").copy())
        truths.append(truth)
        if len(batch) >= batch_size:
            flush()
    flush()
    return (correct / total if total else 0.0), total


def main() -> None:
    p = argparse.ArgumentParser(description="Zero-shot CLIP eval on held-out test set")
    p.add_argument("--model", required=True, help="HF id or local fine-tuned dir")
    p.add_argument("--test", type=Path, required=True)
    p.add_argument("--data-root", type=Path, required=True)
    p.add_argument("--labels", type=Path, required=True)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--sample", type=int, default=0)
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    labels = json.loads(args.labels.read_text(encoding="utf-8"))
    model = CLIPModel.from_pretrained(args.model).to(device).eval()
    processor = CLIPProcessor.from_pretrained(args.model)

    rows = [json.loads(l) for l in args.test.read_text(encoding="utf-8").splitlines() if l.strip()]
    rows = [r for r in rows if (args.data_root / r["image"]).exists()]
    if args.sample and args.sample < len(rows):
        random.Random(args.seed).shuffle(rows)
        rows = rows[: args.sample]

    print(f"model={args.model}  test rows={len(rows)}")
    for key, names in (("style", labels["styles"]), ("genre", labels["genres"])):
        acc, n = zero_shot(model, processor, rows, args.data_root, names, key, device, args.batch_size)
        print(f"  zero-shot {key:6s}: {acc:.4f}  (n={n})")


if __name__ == "__main__":
    main()
