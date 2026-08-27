#!/usr/bin/env python3
"""Build the F2 training package from the local WikiArt tar shards.

Runs LOCALLY on this PC (where the 104 GB `data/WikiArt_dataset/*.tar` already
live). It does NOT need a GPU, torch, or timm — only Pillow + stdlib.

What it produces under --out-dir (default data/f2_dataset):

    images/<key>.jpg            resized train+val images (small, for upload)
    train.jsonl / val.jsonl     manifests for the cluster
    labels.json                 styles / genres / artists label lists
    dataset_stats.json          per-class counts + config used
    test.jsonl                  manifest of the held-out test split
    test_images/<key>.jpg       FULL-RESOLUTION held-out test images (STAY HERE)
    wikiart_f2_trainpkg.tar     <-- upload THIS to the cluster (images+train+val+labels)

The split is deterministic (seeded hash of the image key), so the test set is a
true hold-out that the cluster never sees. The full-res test images are kept on
this machine for offline evaluation (see evaluate_testset.py).

Strategy:
  * Pass 1 (fast): seek-read every `.json` member to collect labels and pick the
    top-K artists. Uncompressed tars allow seeking, so image bytes are skipped.
  * Pass 2: decode only the images we actually keep, resize, and write them out.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import tarfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

# Some WikiArt scans are very large; allow them instead of raising a bomb error.
Image.MAX_IMAGE_PIXELS = None

try:
    from taxonomy import map_style, map_genre, first_or_none
except ImportError:  # when run as a module from repo root
    from backend.training.f2_classification.taxonomy import (  # type: ignore
        map_style,
        map_genre,
        first_or_none,
    )

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp")


@dataclass
class Sample:
    key: str
    tar_name: str
    img_member: str
    artist: str | None
    style: str | None   # canonical or None
    genre: str | None   # canonical or None


def _key_of(member_name: str) -> str:
    # members look like "./0000002_Ivan Aivazovsky - Storm at Sea.jpg"
    stem = Path(member_name).name
    return stem.split("_", 1)[0] if "_" in stem else Path(stem).stem


def _split_for(key: str, seed: int, test_frac: float, val_frac: float) -> str:
    digest = hashlib.blake2b(f"{seed}:{key}".encode("utf-8"), digest_size=8).digest()
    bucket = (int.from_bytes(digest, "big") % 10_000) / 10_000.0
    if bucket < test_frac:
        return "test"
    if bucket < test_frac + val_frac:
        return "val"
    return "train"


def _scan_labels(tar_paths: list[Path]) -> list[Sample]:
    samples: list[Sample] = []
    json_by_key: dict[str, dict] = {}
    img_by_key: dict[str, tuple[str, str]] = {}  # key -> (tar_name, member)

    for tar_path in tar_paths:
        print(f"[pass1] scanning {tar_path.name} ...", flush=True)
        with tarfile.open(tar_path, "r") as tar:
            for member in tar:
                if not member.isfile():
                    continue
                name = member.name
                lower = name.lower()
                key = _key_of(name)
                if lower.endswith(".json"):
                    handle = tar.extractfile(member)
                    if handle is None:
                        continue
                    try:
                        json_by_key[key] = json.loads(handle.read())
                    except Exception:
                        continue
                elif lower.endswith(IMAGE_EXTS):
                    img_by_key[key] = (tar_path.name, name)

    for key, meta in json_by_key.items():
        if key not in img_by_key:
            continue
        tar_name, img_member = img_by_key[key]
        artist = (meta.get("artist") or "").strip() or None
        style = map_style(first_or_none(meta.get("styles")))
        genre = map_genre(first_or_none(meta.get("genres")))
        if style is None and genre is None and artist is None:
            continue
        samples.append(
            Sample(key=key, tar_name=tar_name, img_member=img_member,
                   artist=artist, style=style, genre=genre)
        )
    return samples


def _resize_jpeg(raw: bytes, size: int, quality: int) -> bytes | None:
    try:
        with Image.open(io.BytesIO(raw)) as image:
            image = image.convert("RGB")
            # Resize so the shorter side == `size`, preserving aspect ratio.
            w, h = image.size
            if min(w, h) > size:
                if w <= h:
                    new = (size, max(1, round(h * size / w)))
                else:
                    new = (max(1, round(w * size / h)), size)
                image = image.resize(new, Image.BICUBIC)
            out = io.BytesIO()
            image.save(out, format="JPEG", quality=quality)
            return out.getvalue()
    except Exception:
        return None


def main() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description="Prepare F2 training package from local WikiArt tars")
    parser.add_argument("--dataset-dir", type=Path, default=repo_root / "data" / "WikiArt_dataset")
    parser.add_argument("--out-dir", type=Path, default=repo_root / "data" / "f2_dataset")
    parser.add_argument("--test-frac", type=float, default=0.08, help="fraction held out locally for testing")
    parser.add_argument("--val-frac", type=float, default=0.08)
    parser.add_argument("--num-artists", type=int, default=25, help="top-K most frequent artists to classify")
    parser.add_argument("--min-artist-count", type=int, default=120, help="artist must have >= this many images")
    parser.add_argument("--max-per-style", type=int, default=7000, help="cap dominant styles in train (0 = no cap)")
    parser.add_argument("--train-size", type=int, default=256, help="resized shorter-side px for train/val images")
    parser.add_argument("--test-size", type=int, default=0, help="resize test images too (0 = keep full resolution)")
    parser.add_argument("--jpeg-quality", type=int, default=90)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--limit-tars", type=int, default=0, help="debug: only use first N tar shards")
    args = parser.parse_args()

    tar_paths = sorted(args.dataset_dir.glob("WikiArt_*.tar"))
    if args.limit_tars:
        tar_paths = tar_paths[: args.limit_tars]
    if not tar_paths:
        raise SystemExit(f"No WikiArt_*.tar shards found in {args.dataset_dir}")
    print(f"Found {len(tar_paths)} tar shards")

    samples = _scan_labels(tar_paths)
    print(f"[pass1] {len(samples)} candidate images with at least one usable label")

    # Select the top-K artists by frequency (data-driven -> high accuracy).
    artist_counts = Counter(s.artist for s in samples if s.artist)
    eligible = [(a, c) for a, c in artist_counts.most_common() if c >= args.min_artist_count]
    selected_artists = [a for a, _ in eligible[: args.num_artists]]
    artist_set = set(selected_artists)
    print(f"[labels] selected {len(selected_artists)} artists (>= {args.min_artist_count} imgs each)")

    labels = {
        "styles": sorted(set(s.style for s in samples if s.style)),
        "genres": sorted(set(s.genre for s in samples if s.genre)),
        "artists": selected_artists,
    }

    # Assign splits; drop the artist label for non-selected artists (masked task).
    by_split: dict[str, list[Sample]] = {"train": [], "val": [], "test": []}
    for s in samples:
        if s.artist not in artist_set:
            s = Sample(s.key, s.tar_name, s.img_member, None, s.style, s.genre)
        if s.style is None and s.genre is None and s.artist is None:
            continue
        by_split[_split_for(s.key, args.seed, args.test_frac, args.val_frac)].append(s)

    # Optional cap on dominant styles in the training split only (balances classes,
    # bounds the upload size). Capping is applied on the primary style label.
    if args.max_per_style > 0:
        style_seen: Counter = Counter()
        capped: list[Sample] = []
        # stable order by key so the cap is deterministic
        for s in sorted(by_split["train"], key=lambda x: x.key):
            if s.style is not None:
                if style_seen[s.style] >= args.max_per_style:
                    continue
                style_seen[s.style] += 1
            capped.append(s)
        print(f"[train] capped {len(by_split['train'])} -> {len(capped)} (max {args.max_per_style}/style)")
        by_split["train"] = capped

    # Build a fast lookup so pass 2 extracts only the images we keep.
    keep: dict[str, dict[str, Sample]] = {t.name: {} for t in tar_paths}
    split_of: dict[str, str] = {}
    for split, items in by_split.items():
        for s in items:
            keep[s.tar_name][s.key] = s
            split_of[s.key] = split

    out = args.out_dir
    (out / "images").mkdir(parents=True, exist_ok=True)
    (out / "test_images").mkdir(parents=True, exist_ok=True)

    manifests = {s: [] for s in ("train", "val", "test")}
    written = Counter()
    failed = 0

    for tar_path in tar_paths:
        wanted = keep[tar_path.name]
        if not wanted:
            continue
        print(f"[pass2] extracting {len(wanted)} images from {tar_path.name} ...", flush=True)
        with tarfile.open(tar_path, "r") as tar:
            for member in tar:
                if not member.isfile():
                    continue
                if not member.name.lower().endswith(IMAGE_EXTS):
                    continue
                key = _key_of(member.name)
                s = wanted.get(key)
                if s is None:
                    continue
                handle = tar.extractfile(member)
                if handle is None:
                    failed += 1
                    continue
                raw = handle.read()
                split = split_of[key]
                if split == "test":
                    # keep test images locally (full-res by default; --test-size resizes)
                    dest = out / "test_images" / f"{key}.jpg"
                    if args.test_size > 0:
                        encoded = _resize_jpeg(raw, args.test_size, 95)
                        if encoded is None:
                            failed += 1
                            continue
                        dest.write_bytes(encoded)
                    else:
                        try:
                            with Image.open(io.BytesIO(raw)) as im:
                                im.convert("RGB").save(dest, format="JPEG", quality=95)
                        except Exception:
                            failed += 1
                            continue
                    rel = f"test_images/{key}.jpg"
                else:
                    encoded = _resize_jpeg(raw, args.train_size, args.jpeg_quality)
                    if encoded is None:
                        failed += 1
                        continue
                    dest = out / "images" / f"{key}.jpg"
                    dest.write_bytes(encoded)
                    rel = f"images/{key}.jpg"
                manifests[split].append({
                    "key": key,
                    "image": rel,
                    "style": s.style,
                    "genre": s.genre,
                    "artist": s.artist,
                })
                written[split] += 1

    for split in ("train", "val", "test"):
        path = out / f"{split}.jsonl"
        with path.open("w", encoding="utf-8") as fh:
            for row in manifests[split]:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"wrote {path} ({written[split]} images)")

    (out / "labels.json").write_text(json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8")

    stats = {
        "config": {k: (str(v) if isinstance(v, Path) else v) for k, v in vars(args).items()},
        "counts": {split: written[split] for split in ("train", "val", "test")},
        "label_counts": {
            "styles": len(labels["styles"]),
            "genres": len(labels["genres"]),
            "artists": len(labels["artists"]),
        },
        "per_style_train": dict(Counter(r["style"] for r in manifests["train"] if r["style"])),
        "per_genre_train": dict(Counter(r["genre"] for r in manifests["train"] if r["genre"])),
        "per_artist_train": dict(Counter(r["artist"] for r in manifests["train"] if r["artist"])),
        "failed": failed,
    }
    (out / "dataset_stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")

    # Bundle the upload package: images + train/val manifests + labels (NO test).
    pkg = out / "wikiart_f2_trainpkg.tar"
    print(f"[package] building {pkg.name} (upload this to the cluster) ...", flush=True)
    with tarfile.open(pkg, "w") as tar:
        tar.add(out / "images", arcname="images")
        tar.add(out / "train.jsonl", arcname="train.jsonl")
        tar.add(out / "val.jsonl", arcname="val.jsonl")
        tar.add(out / "labels.json", arcname="labels.json")

    size_gb = pkg.stat().st_size / (1024 ** 3)
    print("\n=== DONE ===")
    print(f"train={written['train']} val={written['val']} test={written['test']} (held out locally)")
    print(f"styles={len(labels['styles'])} genres={len(labels['genres'])} artists={len(labels['artists'])}")
    print(f"upload package: {pkg}  ({size_gb:.2f} GB)")
    print(f"held-out test images: {out / 'test_images'}")


if __name__ == "__main__":
    main()
