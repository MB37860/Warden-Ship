#!/usr/bin/env python3
"""Evaluate the trained F1 embedding on the held-out test set (LOCAL PC).

Embeds the test images with the exported TorchScript embedding model and reports
leave-one-out kNN retrieval quality (style/artist precision@1 and @k) — the
metric that actually matters for F1 search and F5 clustering.

    python evaluate_embed.py \
        --model  data/f1_embed/f1_embed_model.pt \
        --labels data/f1_embed/f1_embed_labels.json \
        --test   data/f2_dataset/test.jsonl \
        --data-root data/f2_dataset --img-size 224 --sample 2000
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import torch
from PIL import Image


def preprocess(path: Path, size: int) -> torch.Tensor:
    resize_to = int(size * 256 / 224)
    with Image.open(path) as im:
        image = im.convert("RGB")
        w, h = image.size
        new = (resize_to, max(1, round(h * resize_to / w))) if w <= h else (max(1, round(w * resize_to / h)), resize_to)
        image = image.resize(new, Image.BICUBIC)
        w, h = image.size
        left, top = (w - size) // 2, (h - size) // 2
        image = image.crop((left, top, left + size, top + size))
        buf = bytearray(image.tobytes())
        return torch.frombuffer(buf, dtype=torch.uint8).float().div(255.0).view(size, size, 3).permute(2, 0, 1).contiguous()


def main() -> None:
    p = argparse.ArgumentParser(description="kNN retrieval eval for the F1 embedding")
    p.add_argument("--model", type=Path, required=True)
    p.add_argument("--labels", type=Path, required=True)
    p.add_argument("--test", type=Path, required=True)
    p.add_argument("--data-root", type=Path, required=True)
    p.add_argument("--img-size", type=int, default=224)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--topk", type=int, default=10)
    p.add_argument("--sample", type=int, default=0)
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    meta = json.loads(args.labels.read_text(encoding="utf-8"))
    label_key = meta.get("label", "style")
    model = torch.jit.load(str(args.model), map_location="cpu")
    model.eval()

    rows = [json.loads(l) for l in args.test.read_text(encoding="utf-8").splitlines() if l.strip()]
    rows = [r for r in rows if r.get(label_key) and (args.data_root / r["image"]).exists()]
    if args.sample and args.sample < len(rows):
        random.Random(args.seed).shuffle(rows)
        rows = rows[: args.sample]
    print(f"embedding {len(rows)} test images (label={label_key}) ...", flush=True)

    embs, labels, batch = [], [], []

    def flush():
        if not batch:
            return
        with torch.inference_mode():
            embs.append(model(torch.stack(batch)).float())
        batch.clear()

    for r in rows:
        batch.append(preprocess(args.data_root / r["image"], args.img_size))
        labels.append(r[label_key])
        if len(batch) >= args.batch_size:
            flush()
    flush()

    embs = torch.cat(embs)
    uniq = {n: i for i, n in enumerate(sorted(set(labels)))}
    lab = torch.tensor([uniq[n] for n in labels])
    sims = embs @ embs.t()
    sims.fill_diagonal_(-2.0)
    k = min(args.topk, embs.size(0) - 1)
    _, idx = sims.topk(k, dim=1)
    nn_lab = lab[idx]
    p1 = (nn_lab[:, 0] == lab).float().mean().item()
    pk = (nn_lab == lab.unsqueeze(1)).float().mean().item()

    print(f"\n=== {label_key} retrieval on held-out test (n={embs.size(0)}) ===")
    print(f"  precision@1  : {p1:.4f}")
    print(f"  precision@{k:<2d}: {pk:.4f}")


if __name__ == "__main__":
    main()
