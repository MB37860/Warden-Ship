#!/usr/bin/env python3
"""Contrastively fine-tune CLIP on WikiArt art captions (cluster).

Runs ON THE CLUSTER inside the NVIDIA PyTorch container (see *.sbatch).

Why
---
F1 typed search ("a stormy sea at night") uses generic CLIP ViT-B/32. This
adapts both CLIP encoders to art vocabulary (movements, genres, painters) with
the standard symmetric InfoNCE loss on (painting, caption) pairs built from the
F2 package metadata. Improves text->image retrieval on art queries.

Reuses the F2 dataset package (images/ + train/val.jsonl). Captions are built by
`captions.build_caption` (shared with the evaluator).

Export
------
Saved with `save_pretrained` as a standard HF CLIP directory, so the backend
loads it unchanged: point clip_service at it via
    CLIPModel.from_pretrained(<dir>) / CLIPProcessor.from_pretrained(<dir>)

Outputs (to --out-dir/clip_art/): config.json, model weights, processor files,
plus clip_metrics.json with best zero-shot style/genre accuracy.
"""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

import torch
import torch.nn.functional as F
from PIL import Image
from torch.utils.data import DataLoader, Dataset

from transformers import CLIPModel, CLIPProcessor

from captions import build_caption


class CaptionDataset(Dataset):
    def __init__(self, manifest: Path, data_root: Path, limit: int = 0):
        self.rows = [json.loads(l) for l in manifest.read_text(encoding="utf-8").splitlines() if l.strip()]
        if limit:
            self.rows = self.rows[:limit]
        self.data_root = data_root

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, idx: int):
        row = self.rows[idx]
        with Image.open(self.data_root / row["image"]) as im:
            image = im.convert("RGB").copy()
        return image, build_caption(row), row


def make_collate(processor):
    def collate(batch):
        images = [b[0] for b in batch]
        texts = [b[1] for b in batch]
        rows = [b[2] for b in batch]
        enc = processor(text=texts, images=images, return_tensors="pt",
                        padding=True, truncation=True)
        return enc, rows
    return collate


def _embeds(features, attr):
    # transformers >=5 returns a model-output object from get_*_features; older
    # versions return a bare tensor. Mirror backend clip_service._feature_tensor.
    if torch.is_tensor(features):
        return features
    for name in (attr, "pooler_output"):
        value = getattr(features, name, None)
        if torch.is_tensor(value):
            return value
    raise RuntimeError("CLIP returned an unsupported feature output")


@torch.no_grad()
def zero_shot_accuracy(model, processor, loader, class_names, key, device) -> float:
    """Zero-shot accuracy: classify each image by nearest style/genre text prompt."""
    model.eval()
    prompts = ([f"a painting in the {c} style" for c in class_names] if key == "style"
               else [f"a {c.lower()} painting" for c in class_names])
    tok = processor(text=prompts, return_tensors="pt", padding=True, truncation=True).to(device)
    text_feat = F.normalize(_embeds(model.get_text_features(**tok), "text_embeds"), dim=-1)
    cmap = {c: i for i, c in enumerate(class_names)}

    correct = total = 0
    for enc, rows in loader:
        pixel_values = enc["pixel_values"].to(device)
        img_feat = F.normalize(_embeds(model.get_image_features(pixel_values=pixel_values), "image_embeds"), dim=-1)
        pred = (img_feat @ text_feat.t()).argmax(dim=-1)
        for i, row in enumerate(rows):
            truth = row.get(key)
            if truth in cmap:
                correct += int(pred[i].item() == cmap[truth])
                total += 1
    return correct / total if total else 0.0


def main() -> None:
    parser = argparse.ArgumentParser(description="Contrastive CLIP fine-tune on art captions")
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--model-name", default="openai/clip-vit-base-patch32")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--lr", type=float, default=3e-6)
    parser.add_argument("--weight-decay", type=float, default=0.1)
    parser.add_argument("--warmup-epochs", type=int, default=1)
    parser.add_argument("--num-workers", type=int, default=8)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--limit-train", type=int, default=0)
    parser.add_argument("--limit-val", type=int, default=0)
    args = parser.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device={device} model={args.model_name}", flush=True)

    labels = json.loads((args.data_dir / "labels.json").read_text(encoding="utf-8"))
    # Force safetensors: the NVIDIA container ships torch <2.6, and recent
    # transformers refuses torch.load on .bin weights (CVE-2025-32434). The
    # openai/clip-vit-base-patch32 repo ships model.safetensors, so this avoids
    # torch.load entirely instead of pinning an old transformers.
    model = CLIPModel.from_pretrained(args.model_name, use_safetensors=True).to(device)
    processor = CLIPProcessor.from_pretrained(args.model_name)
    collate = make_collate(processor)

    train_ds = CaptionDataset(args.data_dir / "train.jsonl", args.data_dir, args.limit_train)
    val_ds = CaptionDataset(args.data_dir / "val.jsonl", args.data_dir, args.limit_val)
    print(f"train={len(train_ds)} val={len(val_ds)}", flush=True)

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,
                              num_workers=args.num_workers, collate_fn=collate, drop_last=True,
                              persistent_workers=args.num_workers > 0)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False,
                            num_workers=args.num_workers, collate_fn=collate,
                            persistent_workers=args.num_workers > 0)

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    steps_per_epoch = max(1, len(train_loader))
    total_steps = args.epochs * steps_per_epoch
    warmup_steps = args.warmup_epochs * steps_per_epoch

    def lr_scale(step: int) -> float:
        if step < warmup_steps:
            return (step + 1) / max(1, warmup_steps)
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        return 0.5 * (1 + math.cos(math.pi * progress))

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_scale)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    export_dir = args.out_dir / "clip_art"
    best_acc = -1.0
    best_metrics = {}

    for epoch in range(1, args.epochs + 1):
        model.train()
        running = 0.0
        for enc, _rows in train_loader:
            enc = {k: v.to(device) for k, v in enc.items()}
            with torch.autocast(device_type="cuda", dtype=torch.bfloat16, enabled=(device == "cuda")):
                out = model(**enc)
                logits = out.logits_per_image
                target = torch.arange(logits.size(0), device=device)
                loss = 0.5 * (F.cross_entropy(logits, target) + F.cross_entropy(logits.t(), target))
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            running += float(loss.item())

        style_acc = zero_shot_accuracy(model, processor, val_loader, labels["styles"], "style", device)
        genre_acc = zero_shot_accuracy(model, processor, val_loader, labels["genres"], "genre", device)
        mean_acc = (style_acc + genre_acc) / 2
        print(f"epoch {epoch:02d} loss={running / steps_per_epoch:.4f} "
              f"zs_style={style_acc:.3f} zs_genre={genre_acc:.3f} mean={mean_acc:.3f}", flush=True)

        if mean_acc > best_acc:
            best_acc = mean_acc
            best_metrics = {"zs_style": style_acc, "zs_genre": genre_acc, "mean": mean_acc, "epoch": epoch}
            model.save_pretrained(export_dir)
            processor.save_pretrained(export_dir)

    (args.out_dir / "clip_metrics.json").write_text(
        json.dumps({"best": best_metrics, "model_name": args.model_name,
                    "config": {k: str(v) for k, v in vars(args).items()}},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"BEST {best_metrics}  ->  {export_dir}", flush=True)


if __name__ == "__main__":
    main()
