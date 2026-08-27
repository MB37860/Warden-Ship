from __future__ import annotations

import argparse
import json
import io
import os
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

from pymongo import MongoClient
from gridfs import GridFS


DEFAULT_REFERENCE_DATASET = "wikiart_all"


def parse_args() -> argparse.Namespace:
    backend_root = Path(__file__).resolve().parents[1]
    repo_root = backend_root.parent
    parser = argparse.ArgumentParser(
        description="Build CLIP embeddings + metadata artifacts for a reference Mongo/GridFS dataset"
    )
    parser.add_argument(
        "--dataset-root",
        type=Path,
        default=repo_root / "data" / DEFAULT_REFERENCE_DATASET,
    )
    parser.add_argument("--output-dir", type=Path, default=backend_root / "data" / "search_reference")
    parser.add_argument("--clip-model", type=str, default="openai/clip-vit-base-patch32")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--mongo-uri", default=os.getenv("MONGO_URI", "mongodb://localhost:27017/"))
    parser.add_argument("--mongo-db", default=os.getenv("F1_REFERENCE_DB", "image_database"))
    parser.add_argument("--gridfs-collection", default=os.getenv("F1_REFERENCE_GRIDFS", "images"))
    parser.add_argument("--source-name", default=os.getenv("F1_REFERENCE_SOURCE", DEFAULT_REFERENCE_DATASET))
    return parser.parse_args()


def l2_normalize(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms = np.clip(norms, 1e-12, None)
    return vectors / norms


def _load_rows(args: argparse.Namespace) -> list[dict]:
    client = MongoClient(args.mongo_uri)
    db = client[args.mongo_db]
    fs = GridFS(db, collection=args.gridfs_collection)

    rows = []
    for grid_out in fs.find():
        rows.append({"image_path": grid_out.filename, "_id": grid_out._id})
    return rows


def load_image_batch(rows: list[dict], args: argparse.Namespace) -> list[Image.Image]:
    images: list[Image.Image] = []
    client = MongoClient(args.mongo_uri)
    db = client[args.mongo_db]
    fs = GridFS(db, collection=args.gridfs_collection)

    for row in rows:
        try:
            image_data = fs.get(row["_id"]).read()
            with Image.open(io.BytesIO(image_data)) as img:
                images.append(img.copy())
        except Exception as exc:
            print(f"Skipping unreadable image from MongoDB: {row.get('image_path', 'unknown')} ({exc})")
    return images





def _as_tensor_features(raw_output: object) -> torch.Tensor:
    if isinstance(raw_output, torch.Tensor):
        return raw_output
    if hasattr(raw_output, "pooler_output"):
        return raw_output.pooler_output
    if isinstance(raw_output, (tuple, list)) and raw_output:
        first = raw_output[0]
        if isinstance(first, torch.Tensor):
            return first
    raise RuntimeError(f"Unsupported CLIP output type: {type(raw_output)}")


def main() -> None:
    args = parse_args()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    rows = _load_rows(args)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    processor = CLIPProcessor.from_pretrained(args.clip_model)
    model = CLIPModel.from_pretrained(args.clip_model).to(device)
    model.eval()

    valid_rows: list[dict] = []
    vectors: list[np.ndarray] = []

    for start in range(0, len(rows), args.batch_size):
        chunk = rows[start : start + args.batch_size]
        images = load_image_batch(chunk, args)
        with torch.inference_mode():
            encoded = processor(images=images, return_tensors="pt", padding=True)
            encoded = {key: value.to(device) for key, value in encoded.items()}
            raw_feats = model.get_image_features(**encoded)
            feats = _as_tensor_features(raw_feats)
            batch_vectors = feats.detach().cpu().numpy().astype(np.float32)

        for row, vec in zip(chunk, batch_vectors):
            valid_rows.append(
                {
                    "_id": str(row["_id"]),
                    "image_path": str(row["image_path"]),
                }
            )
            vectors.append(vec)

        print(f"Processed {min(start + args.batch_size, len(rows))}/{len(rows)}")

    if not vectors:
        raise RuntimeError("No reference image embeddings extracted")

    features = np.vstack(vectors).astype(np.float32)
    features = l2_normalize(features).astype(np.float32)

    meta_path = output_dir / "clip_meta.json"
    emb_path = output_dir / "clip_embeddings.npy"

    with meta_path.open("w", encoding="utf-8") as handle:
        json.dump(
            {
                "source": args.source_name,
                "database": args.mongo_db,
                "clip_model": args.clip_model,
                "items_count": len(valid_rows),
                "embedding_dim": int(features.shape[1]),
                "items": valid_rows,
            },
            handle,
            ensure_ascii=False,
            indent=2,
        )
    np.save(emb_path, features)

    print(f"Wrote {meta_path}")
    print(f"Wrote {emb_path}")
    print(f"Indexed reference paintings: {len(valid_rows)}")


if __name__ == "__main__":
    main()
