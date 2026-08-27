#!/usr/bin/env python3
"""Train an art-tuned image embedding via deep metric learning (ArcFace).

Runs ON THE CLUSTER inside the NVIDIA PyTorch container (see *.sbatch).

Why
---
F1 (Star Atlas search) and F5 (history map) currently embed paintings with
generic CLIP ViT-B/32 — no art adaptation. This trains a backbone + projection
so that paintings of the **same style / artist** sit close together in the
embedding space, which is exactly what similarity search and map clustering
need. It is the modern realisation of the proposal's "LMNN metric learning"
(article A3), using ArcFace instead of LMNN.

It deliberately **reuses the F2 dataset package** (images/ + train/val.jsonl +
labels.json) — no new data prep. The supervision label is selectable
(`--label style` default, or `artist`).

Export
------
The exported TorchScript module is SELF-CONTAINED: it accepts a float image
tensor in [0,1] of shape [B,3,H,W], bakes in the correct normalisation, and
returns an **L2-normalised embedding** [B, embed_dim]. Drop it into the backend
and point the embedding service at it.

Outputs (to --out-dir):
    f1_embed_model.pt     TorchScript embedding model
    f1_embed_labels.json  the class list used for the metric-learning head
    f1_embed_metrics.json best val retrieval metrics + config
    f1_embed_state.pth    raw weights (resume / re-export)
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import random
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from torch.utils.data import DataLoader, Dataset

import timm
from timm.data import resolve_data_config
from torchvision import transforms


# --------------------------------------------------------------------------- #
# Data — reuses the F2 package manifest format.
# --------------------------------------------------------------------------- #
class ManifestDataset(Dataset):
    def __init__(self, manifest: Path, data_root: Path, label_map: dict, label_key: str,
                 transform, limit: int = 0):
        self.rows = []
        with manifest.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                if label_map.get(row.get(label_key), -1) >= 0:  # keep only labelled rows
                    self.rows.append(row)
        if limit:
            self.rows = self.rows[:limit]
        self.data_root = data_root
        self.transform = transform
        self.label_map = label_map
        self.label_key = label_key

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, idx: int):
        row = self.rows[idx]
        with Image.open(self.data_root / row["image"]) as im:
            image = self.transform(im.convert("RGB"))
        label = self.label_map.get(row.get(self.label_key), -1)
        return image, label


# --------------------------------------------------------------------------- #
# Model
# --------------------------------------------------------------------------- #
class EmbeddingNet(nn.Module):
    """Backbone + projection -> L2-normalised embedding, normalisation baked in."""

    def __init__(self, backbone: nn.Module, feat_dim: int, embed_dim: int, mean, std):
        super().__init__()
        self.backbone = backbone
        self.proj = nn.Linear(feat_dim, embed_dim)
        self.register_buffer("mean", torch.tensor(mean).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor(std).view(1, 3, 1, 1))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = (x - self.mean) / self.std
        feats = self.backbone(x)
        emb = self.proj(feats)
        return F.normalize(emb, dim=-1)


class ArcMarginProduct(nn.Module):
    """ArcFace head: cosine logits with an additive angular margin on the target."""

    def __init__(self, embed_dim: int, n_classes: int, scale: float = 30.0, margin: float = 0.3):
        super().__init__()
        self.weight = nn.Parameter(torch.empty(n_classes, embed_dim))
        nn.init.xavier_uniform_(self.weight)
        self.scale = scale
        self.margin = margin

    def forward(self, embeddings: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        # fp32 for numerical stability under bf16 autocast.
        embeddings = embeddings.float()
        weight = F.normalize(self.weight.float(), dim=-1)
        cosine = F.linear(embeddings, weight).clamp(-1 + 1e-6, 1 - 1e-6)
        # Additive angular margin via the cos/sin identity instead of acos. The
        # acos gradient is -1/sqrt(1-cos^2), which explodes as cosine->1 (i.e.
        # exactly when the model starts separating classes, around epoch 2) and
        # is the classic source of ArcFace NaNs. This insightface-style form is
        # numerically stable.
        sine = torch.sqrt((1.0 - cosine * cosine).clamp_min(1e-12))
        cos_m, sin_m = math.cos(self.margin), math.sin(self.margin)
        phi = cosine * cos_m - sine * sin_m
        # Keep the target logit monotonic when theta + margin > pi (revert to a
        # linear penalty), the standard insightface guard.
        th = math.cos(math.pi - self.margin)
        mm = math.sin(math.pi - self.margin) * self.margin
        phi = torch.where(cosine > th, phi, cosine - mm)
        one_hot = F.one_hot(target, num_classes=cosine.size(1)).float()
        output = one_hot * phi + (1.0 - one_hot) * cosine
        return output * self.scale


@torch.no_grad()
def evaluate_retrieval(model, loader, device, topk: int = 10) -> dict:
    """Leave-one-out kNN over the val set: style/artist precision@1 and @k."""
    model.eval()
    embs, labels = [], []
    for images, label in loader:
        images = images.to(device, non_blocking=True)
        embs.append(model(images).float().cpu())
        labels.append(label)
    if not embs:
        return {"p@1": 0.0, f"p@{topk}": 0.0, "n": 0}
    embs = torch.cat(embs)
    labels = torch.cat(labels)
    n = embs.size(0)
    sims = embs @ embs.t()
    sims.fill_diagonal_(-2.0)  # exclude self
    k = min(topk, n - 1)
    _, idx = sims.topk(k, dim=1)
    nn_labels = labels[idx]
    p1 = (nn_labels[:, 0] == labels).float().mean().item()
    pk = (nn_labels == labels.unsqueeze(1)).float().mean().item()
    return {"p@1": p1, f"p@{topk}": pk, "n": n}


def main() -> None:
    parser = argparse.ArgumentParser(description="Train art embedding via ArcFace metric learning")
    parser.add_argument("--data-dir", type=Path, required=True, help="extracted F2 package (images/ + *.jsonl + labels.json)")
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--backbone", default="vit_base_patch16_clip_224.openai")
    parser.add_argument("--label", choices=["style", "artist"], default="style",
                        help="which label supervises the metric space")
    parser.add_argument("--embed-dim", type=int, default=512)
    parser.add_argument("--img-size", type=int, default=224)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--grad-accum", type=int, default=1)
    parser.add_argument("--lr-head", type=float, default=1e-3)
    parser.add_argument("--lr-backbone", type=float, default=1e-5)
    parser.add_argument("--weight-decay", type=float, default=0.05)
    parser.add_argument("--warmup-epochs", type=int, default=1)
    parser.add_argument("--arc-scale", type=float, default=30.0)
    parser.add_argument("--arc-margin", type=float, default=0.3)
    parser.add_argument("--grad-clip", type=float, default=1.0,
                        help="max grad norm; 0 disables. Stabilises ArcFace after warmup.")
    parser.add_argument("--ema", action="store_true")
    parser.add_argument("--ema-decay", type=float, default=0.9998)
    parser.add_argument("--amp-dtype", choices=["fp16", "bf16"], default="bf16")
    parser.add_argument("--grad-checkpointing", action="store_true")
    parser.add_argument("--num-workers", type=int, default=8)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--pretrained", dest="pretrained", action="store_true", default=True)
    parser.add_argument("--no-pretrained", dest="pretrained", action="store_false",
                        help="random init (for offline smoke tests only)")
    parser.add_argument("--limit-train", type=int, default=0, help="cap train rows (smoke test)")
    parser.add_argument("--limit-val", type=int, default=0, help="cap val rows (smoke test)")
    args = parser.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    amp_dtype = torch.bfloat16 if args.amp_dtype == "bf16" else torch.float16
    label_plural = {"style": "styles", "artist": "artists"}[args.label]
    print(f"device={device} backbone={args.backbone} label={args.label} "
          f"embed_dim={args.embed_dim} img_size={args.img_size}", flush=True)

    labels = json.loads((args.data_dir / "labels.json").read_text(encoding="utf-8"))
    class_names = labels[label_plural]
    label_map = {name: i for i, name in enumerate(class_names)}

    backbone = timm.create_model(args.backbone, pretrained=args.pretrained, num_classes=0, img_size=args.img_size)
    cfg = resolve_data_config({}, model=backbone)
    mean, std = cfg["mean"], cfg["std"]
    feat_dim = backbone.num_features
    if args.grad_checkpointing:
        backbone.set_grad_checkpointing(True)

    model = EmbeddingNet(backbone, feat_dim, args.embed_dim, mean, std).to(device)
    head = ArcMarginProduct(args.embed_dim, len(class_names), args.arc_scale, args.arc_margin).to(device)

    ema_model = copy.deepcopy(model) if args.ema else None
    if ema_model is not None:
        for p in ema_model.parameters():
            p.requires_grad_(False)

    train_tf = transforms.Compose([
        transforms.RandomResizedCrop(args.img_size, scale=(0.6, 1.0),
                                     interpolation=transforms.InterpolationMode.BICUBIC),
        transforms.RandomHorizontalFlip(),
        transforms.ColorJitter(0.1, 0.1, 0.1),
        transforms.ToTensor(),
    ])
    eval_tf = transforms.Compose([
        transforms.Resize(int(args.img_size * 256 / 224), interpolation=transforms.InterpolationMode.BICUBIC),
        transforms.CenterCrop(args.img_size),
        transforms.ToTensor(),
    ])

    train_ds = ManifestDataset(args.data_dir / "train.jsonl", args.data_dir, label_map, args.label, train_tf, args.limit_train)
    val_ds = ManifestDataset(args.data_dir / "val.jsonl", args.data_dir, label_map, args.label, eval_tf, args.limit_val)
    print(f"train={len(train_ds)} val={len(val_ds)} classes={len(class_names)}", flush=True)

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,
                              num_workers=args.num_workers, pin_memory=True, drop_last=True,
                              persistent_workers=args.num_workers > 0)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False,
                            num_workers=args.num_workers, pin_memory=True,
                            persistent_workers=args.num_workers > 0)

    param_groups = [
        {"params": list(model.proj.parameters()) + list(head.parameters()), "lr": args.lr_head},
        {"params": model.backbone.parameters(), "lr": args.lr_backbone},
    ]
    optimizer = torch.optim.AdamW(param_groups, weight_decay=args.weight_decay)

    steps_per_epoch = max(1, len(train_loader) // args.grad_accum)
    total_steps = args.epochs * steps_per_epoch
    warmup_steps = args.warmup_epochs * steps_per_epoch

    def lr_scale(step: int) -> float:
        if step < warmup_steps:
            return (step + 1) / max(1, warmup_steps)
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        return 0.5 * (1 + math.cos(math.pi * progress))

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_scale)
    scaler = torch.amp.GradScaler("cuda", enabled=(device == "cuda" and args.amp_dtype == "fp16"))

    args.out_dir.mkdir(parents=True, exist_ok=True)
    best_p1 = -1.0
    best_metrics = {}

    for epoch in range(1, args.epochs + 1):
        model.train()
        head.train()
        running = 0.0
        optimizer.zero_grad(set_to_none=True)
        for it, (images, target) in enumerate(train_loader):
            images = images.to(device, non_blocking=True)
            target = target.to(device)
            with torch.autocast(device_type="cuda", dtype=amp_dtype, enabled=(device == "cuda")):
                emb = model(images)
                logits = head(emb, target)
                loss = F.cross_entropy(logits, target) / args.grad_accum
            if not torch.isfinite(loss):
                # Skip a poisoned batch instead of letting one NaN wipe the weights.
                optimizer.zero_grad(set_to_none=True)
                continue
            scaler.scale(loss).backward()
            running += float(loss.item()) * args.grad_accum
            if (it + 1) % args.grad_accum == 0:
                if args.grad_clip > 0:
                    scaler.unscale_(optimizer)
                    torch.nn.utils.clip_grad_norm_(
                        list(model.parameters()) + list(head.parameters()), args.grad_clip)
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)
                scheduler.step()
                if ema_model is not None:
                    with torch.no_grad():
                        d = args.ema_decay
                        for pe, pm in zip(ema_model.parameters(), model.parameters()):
                            pe.mul_(d).add_(pm.detach(), alpha=1 - d)
                        for be, bm in zip(ema_model.buffers(), model.buffers()):
                            be.copy_(bm)

        eval_target = ema_model if ema_model is not None else model
        metrics = evaluate_retrieval(eval_target, val_loader, device)
        print(f"epoch {epoch:02d} loss={running / max(1, len(train_loader)):.4f} "
              f"p@1={metrics['p@1']:.3f} p@10={metrics['p@10']:.3f}", flush=True)

        if metrics["p@1"] > best_p1:
            best_p1 = metrics["p@1"]
            best_metrics = {**metrics, "epoch": epoch}
            torch.save(eval_target.state_dict(), args.out_dir / "f1_embed_state.pth")
            _export(eval_target, args, class_names)

    (args.out_dir / "f1_embed_metrics.json").write_text(
        json.dumps({"best": best_metrics, "label": args.label, "embed_dim": args.embed_dim,
                    "backbone": args.backbone, "input_size": args.img_size,
                    "config": {k: str(v) for k, v in vars(args).items()},
                    "mean": list(mean), "std": list(std)}, ensure_ascii=False, indent=2),
        encoding="utf-8")
    print(f"BEST {best_metrics}", flush=True)


def _export(model: EmbeddingNet, args, class_names: list) -> None:
    model.eval()
    was_cuda = next(model.parameters()).is_cuda
    model.to("cpu")
    if hasattr(model.backbone, "set_grad_checkpointing"):
        model.backbone.set_grad_checkpointing(False)
    example = torch.zeros(1, 3, args.img_size, args.img_size)
    with torch.no_grad():
        traced = torch.jit.trace(model, example, strict=False)
    traced.save(str(args.out_dir / "f1_embed_model.pt"))
    (args.out_dir / "f1_embed_labels.json").write_text(
        json.dumps({"label": args.label, "classes": class_names}, ensure_ascii=False, indent=2),
        encoding="utf-8")
    if was_cuda:
        model.to("cuda")


if __name__ == "__main__":
    main()
