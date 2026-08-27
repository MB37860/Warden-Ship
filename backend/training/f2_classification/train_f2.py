#!/usr/bin/env python3
"""Fine-tune the F2 multi-task classifier (style / genre / artist).

Runs ON THE CLUSTER inside the NVIDIA PyTorch container (see *.sbatch).

Design
------
* Backbone: a pretrained timm vision model (default a CLIP-pretrained ViT-B/16;
  use vit_large_patch14_clip_336.openai for the high-accuracy run). The whole
  network is fine-tuned, with a lower LR on the backbone and a higher LR on heads.
* Heads: three independent linear classifiers on the pooled features.
* Masked multi-task loss: each image only supervises the heads whose label it has
  (label index == -1 => ignored), so every image contributes to whichever of
  style/genre/artist it actually has.

High-accuracy options (all default OFF, so the fast baseline is reproducible):
  --label-smoothing 0.1   --mixup-alpha 0.2   --randaug   --ema   --tta
  --grad-accum N   --amp-dtype bf16

Export
------
The exported TorchScript module is SELF-CONTAINED: it accepts a float image
tensor in [0,1] of shape [B,3,H,W] and bakes in the correct normalisation, and
returns a tuple (style_logits, genre_logits, artist_logits). The app must feed it
images at the trained --img-size (set F2_INPUT_SIZE for non-224 models).

Outputs (to --out-dir):
    f2_image_model.pt     TorchScript model (set F2_MODEL_PATH to this)
    f2_labels.json        label lists (set F2_LABELS_PATH to this)
    f2_metrics.json       best val accuracy per head + config (incl. input_size)
    f2_state.pth          raw weights (for resuming / re-export)
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
# Data
# --------------------------------------------------------------------------- #
class ManifestDataset(Dataset):
    def __init__(self, manifest: Path, data_root: Path, label_maps: dict, transform):
        self.rows = []
        with manifest.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    self.rows.append(json.loads(line))
        self.data_root = data_root
        self.transform = transform
        self.smap = label_maps["styles"]
        self.gmap = label_maps["genres"]
        self.amap = label_maps["artists"]

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, idx: int):
        row = self.rows[idx]
        path = self.data_root / row["image"]
        with Image.open(path) as im:
            image = self.transform(im.convert("RGB"))
        style = self.smap.get(row.get("style"), -1)
        genre = self.gmap.get(row.get("genre"), -1)
        artist = self.amap.get(row.get("artist"), -1)
        return image, style, genre, artist


# --------------------------------------------------------------------------- #
# Model
# --------------------------------------------------------------------------- #
class MultiTaskClassifier(nn.Module):
    """Backbone + 3 heads, with normalisation baked in for self-contained export."""

    def __init__(self, backbone: nn.Module, feat_dim: int, n_style: int, n_genre: int,
                 n_artist: int, mean, std):
        super().__init__()
        self.backbone = backbone
        self.style = nn.Linear(feat_dim, n_style)
        self.genre = nn.Linear(feat_dim, n_genre)
        self.artist = nn.Linear(feat_dim, n_artist)
        self.register_buffer("mean", torch.tensor(mean).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor(std).view(1, 3, 1, 1))

    def forward(self, x: torch.Tensor):
        # x is expected in [0,1]; normalise here so the exported model is standalone.
        x = (x - self.mean) / self.std
        feats = self.backbone(x)
        return self.style(feats), self.genre(feats), self.artist(feats)


def _class_weights(manifest_rows, key: str, label_map: dict, device) -> torch.Tensor:
    counts = torch.zeros(len(label_map))
    for row in manifest_rows:
        idx = label_map.get(row.get(key), -1)
        if idx >= 0:
            counts[idx] += 1
    counts = counts.clamp(min=1.0)
    weights = counts.sum() / (len(label_map) * counts)
    return weights.clamp(max=10.0).to(device)


def _masked_ce(logits, target, weight, smoothing: float) -> torch.Tensor:
    if (target >= 0).sum() == 0:
        return logits.sum() * 0.0
    return F.cross_entropy(logits, target, weight=weight, ignore_index=-1,
                           label_smoothing=smoothing)


def multitask_loss(logits, targets, weights, smoothing: float) -> torch.Tensor:
    s, g, a = logits
    sy, gy, ay = targets
    ws, wg, wa = weights
    return (_masked_ce(s, sy, ws, smoothing)
            + _masked_ce(g, gy, wg, smoothing)
            + _masked_ce(a, ay, wa, smoothing))


@torch.no_grad()
def evaluate(model, loader, device, tta: bool = False) -> dict:
    model.eval()
    correct = {"style": 0, "genre": 0, "artist": 0}
    total = {"style": 0, "genre": 0, "artist": 0}
    for images, sy, gy, ay in loader:
        images = images.to(device, non_blocking=True)
        s, g, a = model(images)
        if tta:  # average logits with a horizontal flip
            s2, g2, a2 = model(torch.flip(images, dims=[3]))
            s, g, a = s + s2, g + g2, a + a2
        for name, logits, target in (("style", s, sy), ("genre", g, gy), ("artist", a, ay)):
            target = target.to(device)
            mask = target >= 0
            if mask.any():
                pred = logits.argmax(dim=-1)
                correct[name] += int((pred[mask] == target[mask]).sum())
                total[name] += int(mask.sum())
    return {name: (correct[name] / total[name] if total[name] else 0.0) for name in correct}


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune F2 multi-task classifier")
    parser.add_argument("--data-dir", type=Path, required=True, help="extracted package (images/ + *.jsonl + labels.json)")
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--backbone", default="vit_base_patch16_clip_224.openai")
    parser.add_argument("--img-size", type=int, default=224)
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--grad-accum", type=int, default=1, help="accumulate N steps for a larger effective batch")
    parser.add_argument("--lr-head", type=float, default=1e-3)
    parser.add_argument("--lr-backbone", type=float, default=1e-5)
    parser.add_argument("--weight-decay", type=float, default=0.05)
    parser.add_argument("--warmup-epochs", type=int, default=1)
    parser.add_argument("--label-smoothing", type=float, default=0.0)
    parser.add_argument("--mixup-alpha", type=float, default=0.0, help="Beta(a,a) mixup; 0 disables")
    parser.add_argument("--randaug", action="store_true", help="RandAugment in train transform")
    parser.add_argument("--ema", action="store_true", help="track + export an EMA of the weights")
    parser.add_argument("--ema-decay", type=float, default=0.9998)
    parser.add_argument("--tta", action="store_true", help="hflip test-time augmentation at eval")
    parser.add_argument("--amp-dtype", choices=["fp16", "bf16"], default="fp16")
    parser.add_argument("--grad-checkpointing", action="store_true", help="trade compute for memory (big backbones)")
    parser.add_argument("--freeze-backbone", action="store_true", help="linear-probe only (fast)")
    parser.add_argument("--num-workers", type=int, default=8)
    parser.add_argument("--no-class-weights", action="store_true")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    amp_dtype = torch.bfloat16 if args.amp_dtype == "bf16" else torch.float16
    print(f"device={device} backbone={args.backbone} img_size={args.img_size} "
          f"amp={args.amp_dtype} mixup={args.mixup_alpha} ema={args.ema}", flush=True)

    labels = json.loads((args.data_dir / "labels.json").read_text(encoding="utf-8"))
    label_maps = {k: {name: i for i, name in enumerate(labels[k])} for k in ("styles", "genres", "artists")}

    # Backbone (feature extractor: num_classes=0 -> pooled features).
    backbone = timm.create_model(args.backbone, pretrained=True, num_classes=0, img_size=args.img_size)
    cfg = resolve_data_config({}, model=backbone)
    mean, std = cfg["mean"], cfg["std"]
    feat_dim = backbone.num_features
    if args.grad_checkpointing:
        backbone.set_grad_checkpointing(True)
    if args.freeze_backbone:
        for p in backbone.parameters():
            p.requires_grad = False

    model = MultiTaskClassifier(
        backbone, feat_dim,
        len(labels["styles"]), len(labels["genres"]), len(labels["artists"]),
        mean, std,
    ).to(device)

    ema_model = copy.deepcopy(model) if args.ema else None
    if ema_model is not None:
        for p in ema_model.parameters():
            p.requires_grad_(False)

    # Transforms output tensors in [0,1] (no normalisation here; baked into model).
    train_ops = [transforms.RandomResizedCrop(args.img_size, scale=(0.6, 1.0),
                                              interpolation=transforms.InterpolationMode.BICUBIC),
                 transforms.RandomHorizontalFlip()]
    if args.randaug:
        train_ops.append(transforms.RandAugment(num_ops=2, magnitude=9))
    else:
        train_ops.append(transforms.ColorJitter(0.1, 0.1, 0.1))
    train_ops.append(transforms.ToTensor())
    train_tf = transforms.Compose(train_ops)
    eval_tf = transforms.Compose([
        transforms.Resize(int(args.img_size * 256 / 224), interpolation=transforms.InterpolationMode.BICUBIC),
        transforms.CenterCrop(args.img_size),
        transforms.ToTensor(),
    ])

    train_ds = ManifestDataset(args.data_dir / "train.jsonl", args.data_dir, label_maps, train_tf)
    val_ds = ManifestDataset(args.data_dir / "val.jsonl", args.data_dir, label_maps, eval_tf)
    print(f"train={len(train_ds)} val={len(val_ds)}", flush=True)

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,
                              num_workers=args.num_workers, pin_memory=True, drop_last=True,
                              persistent_workers=args.num_workers > 0)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False,
                            num_workers=args.num_workers, pin_memory=True,
                            persistent_workers=args.num_workers > 0)

    if args.no_class_weights:
        weights = (None, None, None)
    else:
        weights = (_class_weights(train_ds.rows, "style", label_maps["styles"], device),
                   _class_weights(train_ds.rows, "genre", label_maps["genres"], device),
                   _class_weights(train_ds.rows, "artist", label_maps["artists"], device))

    head_params = list(model.style.parameters()) + list(model.genre.parameters()) + list(model.artist.parameters())
    param_groups = [{"params": head_params, "lr": args.lr_head}]
    if not args.freeze_backbone:
        param_groups.append({"params": model.backbone.parameters(), "lr": args.lr_backbone})
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
    best_mean = -1.0
    best_metrics = {}

    for epoch in range(1, args.epochs + 1):
        model.train()
        running = 0.0
        optimizer.zero_grad(set_to_none=True)
        for it, (images, sy, gy, ay) in enumerate(train_loader):
            images = images.to(device, non_blocking=True)
            sy, gy, ay = sy.to(device), gy.to(device), ay.to(device)
            with torch.autocast(device_type="cuda", dtype=amp_dtype, enabled=(device == "cuda")):
                if args.mixup_alpha > 0:
                    lam = float(torch.distributions.Beta(args.mixup_alpha, args.mixup_alpha).sample())
                    perm = torch.randperm(images.size(0), device=device)
                    images = lam * images + (1 - lam) * images[perm]
                    logits = model(images)
                    loss = (lam * multitask_loss(logits, (sy, gy, ay), weights, args.label_smoothing)
                            + (1 - lam) * multitask_loss(logits, (sy[perm], gy[perm], ay[perm]), weights, args.label_smoothing))
                else:
                    logits = model(images)
                    loss = multitask_loss(logits, (sy, gy, ay), weights, args.label_smoothing)
                loss = loss / args.grad_accum
            scaler.scale(loss).backward()
            running += float(loss.item()) * args.grad_accum
            if (it + 1) % args.grad_accum == 0:
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
        metrics = evaluate(eval_target, val_loader, device, tta=args.tta)
        mean_acc = sum(metrics.values()) / 3
        print(f"epoch {epoch:02d} loss={running / max(1, len(train_loader)):.4f} "
              f"style={metrics['style']:.3f} genre={metrics['genre']:.3f} "
              f"artist={metrics['artist']:.3f} mean={mean_acc:.3f}", flush=True)

        if mean_acc > best_mean:
            best_mean = mean_acc
            best_metrics = {**metrics, "mean": mean_acc, "epoch": epoch}
            torch.save(eval_target.state_dict(), args.out_dir / "f2_state.pth")
            _export(eval_target, args, labels)

    (args.out_dir / "f2_metrics.json").write_text(
        json.dumps({"best": best_metrics, "config": {k: str(v) for k, v in vars(args).items()},
                    "backbone": args.backbone, "input_size": args.img_size,
                    "mean": list(mean), "std": list(std)},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"BEST {best_metrics}", flush=True)


def _export(model: MultiTaskClassifier, args, labels: dict) -> None:
    model.eval()
    was_cuda = next(model.parameters()).is_cuda
    model.to("cpu")
    # grad-checkpointing uses torch.utils.checkpoint which is incompatible with
    # torch.jit.trace (raises _Map_base::at). Disable it just for the trace.
    if hasattr(model.backbone, "set_grad_checkpointing"):
        model.backbone.set_grad_checkpointing(False)
    example = torch.zeros(1, 3, args.img_size, args.img_size)
    with torch.no_grad():
        traced = torch.jit.trace(model, example, strict=False)
    traced.save(str(args.out_dir / "f2_image_model.pt"))
    (args.out_dir / "f2_labels.json").write_text(
        json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8")
    if was_cuda:
        model.to("cuda")


if __name__ == "__main__":
    main()
