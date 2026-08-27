"""Train F2 style/genre/artist heads from frozen CLIP embeddings.

This is intended for an offline GPU machine or cluster. The exported files are
small local runtime artifacts:

    F2_MODEL_KIND=clip-linear
    F2_MODEL_PATH=/path/to/f2_clip_heads.pt
    F2_LABELS_PATH=/path/to/f2_labels.json

Manifest input can be JSON, JSONL, or CSV. Each row needs:
    image or path, style, genre, artist
"""

from __future__ import annotations

import argparse
import csv
import json
import random
from dataclasses import dataclass
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from transformers import CLIPModel, CLIPProcessor


@dataclass
class Record:
    image_path: Path
    style: str
    genre: str
    artist: str


class ClipLinearHeads(nn.Module):
    def __init__(self, embedding_dim: int, style_count: int, genre_count: int, artist_count: int) -> None:
        super().__init__()
        self.style = nn.Linear(embedding_dim, style_count)
        self.genre = nn.Linear(embedding_dim, genre_count)
        self.artist = nn.Linear(embedding_dim, artist_count)

    def forward(self, embeddings: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        return self.style(embeddings), self.genre(embeddings), self.artist(embeddings)


def _read_manifest(path: Path, image_root: Path | None) -> list[Record]:
    if path.suffix.lower() == ".csv":
        with path.open("r", encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
    else:
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            rows = []
        elif text.startswith("["):
            rows = json.loads(text)
        else:
            rows = [json.loads(line) for line in text.splitlines() if line.strip()]

    records = []
    for row in rows:
        raw_path = row.get("image") or row.get("path") or row.get("image_path")
        style = str(row.get("style") or "").strip()
        genre = str(row.get("genre") or "").strip()
        artist = str(row.get("artist") or row.get("author") or "").strip()
        if not raw_path or not style or not genre or not artist:
            continue
        image_path = Path(raw_path)
        if image_root and not image_path.is_absolute():
            image_path = image_root / image_path
        if image_path.exists():
            records.append(Record(image_path=image_path, style=style, genre=genre, artist=artist))
    return records


def _label_maps(records: list[Record]) -> tuple[dict[str, list[str]], dict[str, dict[str, int]]]:
    labels = {
        "styles": sorted({record.style for record in records}),
        "genres": sorted({record.genre for record in records}),
        "artists": sorted({record.artist for record in records}),
    }
    maps = {key: {label: index for index, label in enumerate(values)} for key, values in labels.items()}
    return labels, maps


def _embed_images(
    records: list[Record],
    processor: CLIPProcessor,
    model: CLIPModel,
    device: str,
    batch_size: int,
) -> torch.Tensor:
    embeddings = []
    for start in range(0, len(records), batch_size):
        batch = records[start:start + batch_size]
        images = []
        for record in batch:
            with Image.open(record.image_path) as image:
                images.append(image.convert("RGB"))
        encoded = processor(images=images, return_tensors="pt", padding=True)
        encoded = {key: value.to(device) for key, value in encoded.items()}
        with torch.inference_mode():
            features = model.get_image_features(**encoded)
            features = F.normalize(features, dim=-1)
        embeddings.append(features.detach().cpu())
        print(f"embedded {min(start + batch_size, len(records))}/{len(records)}")
    return torch.cat(embeddings, dim=0)


def _targets(records: list[Record], maps: dict[str, dict[str, int]]) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    return (
        torch.tensor([maps["styles"][record.style] for record in records], dtype=torch.long),
        torch.tensor([maps["genres"][record.genre] for record in records], dtype=torch.long),
        torch.tensor([maps["artists"][record.artist] for record in records], dtype=torch.long),
    )


def _accuracy(logits: torch.Tensor, target: torch.Tensor) -> float:
    return float((logits.argmax(dim=-1) == target).float().mean().item())


def main() -> None:
    parser = argparse.ArgumentParser(description="Train F2 CLIP linear heads")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--image-root", type=Path, default=None)
    parser.add_argument("--output-model", type=Path, required=True)
    parser.add_argument("--output-labels", type=Path, required=True)
    parser.add_argument("--clip-model", default="openai/clip-vit-base-patch32")
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="cuda")
    args = parser.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = args.device if args.device.startswith("cuda") and torch.cuda.is_available() else "cpu"

    records = _read_manifest(args.manifest, args.image_root)
    if not records:
        raise RuntimeError("No complete training records found")
    random.shuffle(records)
    labels, maps = _label_maps(records)

    processor = CLIPProcessor.from_pretrained(args.clip_model)
    clip_model = CLIPModel.from_pretrained(args.clip_model).to(device)
    clip_model.eval()

    embeddings = _embed_images(records, processor, clip_model, device, args.batch_size)
    style_y, genre_y, artist_y = _targets(records, maps)

    model = ClipLinearHeads(
        embeddings.shape[1],
        len(labels["styles"]),
        len(labels["genres"]),
        len(labels["artists"]),
    ).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)

    dataset_size = embeddings.shape[0]
    indices = torch.arange(dataset_size)
    for epoch in range(1, args.epochs + 1):
        permutation = indices[torch.randperm(dataset_size)]
        model.train()
        total_loss = 0.0
        for start in range(0, dataset_size, args.batch_size):
            batch_idx = permutation[start:start + args.batch_size]
            x = embeddings[batch_idx].to(device)
            targets = (style_y[batch_idx].to(device), genre_y[batch_idx].to(device), artist_y[batch_idx].to(device))
            logits = model(x)
            loss = sum(F.cross_entropy(head, target) for head, target in zip(logits, targets))
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            total_loss += float(loss.item()) * len(batch_idx)

        model.eval()
        with torch.inference_mode():
            logits = model(embeddings.to(device))
            acc = (
                _accuracy(logits[0].cpu(), style_y),
                _accuracy(logits[1].cpu(), genre_y),
                _accuracy(logits[2].cpu(), artist_y),
            )
        print(
            f"epoch {epoch:03d} loss={total_loss / dataset_size:.4f} "
            f"style={acc[0]:.3f} genre={acc[1]:.3f} artist={acc[2]:.3f}"
        )

    args.output_model.parent.mkdir(parents=True, exist_ok=True)
    args.output_labels.parent.mkdir(parents=True, exist_ok=True)
    model.eval()
    traced = torch.jit.trace(model.cpu(), torch.zeros(1, embeddings.shape[1]))
    traced.save(str(args.output_model))
    args.output_labels.write_text(json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {args.output_model}")
    print(f"wrote {args.output_labels}")


if __name__ == "__main__":
    main()
