"""Train the F5 year-estimation head on precomputed WikiArt CLIP embeddings.

The WikiArt dataset ships CLIP ViT-B/32 image embeddings row-aligned with
WikiArt.parquet (verified: cosine ~1.0 against embeddings computed with the
backend's openai/clip-vit-base-patch32), so no image decoding is needed and
the head consumes exactly the vectors the backend produces at runtime.

Design:
- year -> decade bins (1300-2029); training minimizes cross-entropy against
  Gaussian-smoothed soft targets, prediction is the expectation over bin
  centers. This behaves like ordinal regression and gives a confidence.
- samples are weighted by inverse sqrt of decade frequency because WikiArt is
  heavily skewed toward 1800-2000.
- the split is artist-disjoint (a painter never appears in both train and
  test), which is the conservative estimate for unseen archives.

Outputs (data/f5_year_head/):
- f5_year_head.pt      TorchScript: (N,512) CLIP vectors -> (years, confidence)
- f5_year_head_metrics.json
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch import nn

REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_ROOT = REPO_ROOT / "data" / "WikiArt_dataset"
OUT_DIR = REPO_ROOT / "data" / "f5_year_head"

YEAR_MIN, YEAR_MAX, BIN_YEARS = 1300, 2029, 10
N_BINS = (YEAR_MAX + 1 - YEAR_MIN) // BIN_YEARS  # 73
BIN_CENTERS = np.arange(N_BINS) * BIN_YEARS + YEAR_MIN + BIN_YEARS / 2.0
TARGET_SIGMA_BINS = 1.5  # ~15 years of label smoothing
SEED = 42


class YearMLP(nn.Module):
    def __init__(self, dim: int = 512, hidden: int = 512, n_bins: int = N_BINS):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(dim, hidden),
            nn.GELU(),
            nn.Dropout(0.15),
            nn.Linear(hidden, n_bins),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class YearHead(nn.Module):
    """Export wrapper: normalization + expectation baked in."""

    def __init__(self, mlp: YearMLP, centers: np.ndarray):
        super().__init__()
        self.mlp = mlp
        self.register_buffer("centers", torch.tensor(centers, dtype=torch.float32))

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        x = x / torch.linalg.vector_norm(x, dim=-1, keepdim=True).clamp_min(1e-8)
        probs = self.mlp(x).softmax(dim=-1)
        years = (probs * self.centers).sum(dim=-1)
        confidence = probs.max(dim=-1).values
        return years, confidence


def _artist_split(artists: pd.Series) -> np.ndarray:
    """0=train, 1=val, 2=test by stable hash of the artist name (80/10/10)."""

    def bucket(name: str) -> int:
        digest = hashlib.sha256(name.strip().lower().encode("utf-8")).digest()
        value = int.from_bytes(digest[:4], "big") % 10
        return 0 if value < 8 else (1 if value == 8 else 2)

    return artists.fillna("unknown").map(bucket).to_numpy()


def load_dataset() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    df = pd.read_parquet(DATA_ROOT / "WikiArt.parquet", columns=["artist", "completion"])
    emb = np.load(DATA_ROOT / "img_emb" / "WikiArt_image.npy", mmap_mode="r")
    years = pd.to_numeric(df["completion"], errors="coerce")
    mask = ((years >= 800) & (years <= 2026)).fillna(False)
    idx = np.flatnonzero(mask.to_numpy(dtype=bool))
    x = np.asarray(emb[idx], dtype=np.float32)
    x /= np.clip(np.linalg.norm(x, axis=1, keepdims=True), 1e-8, None)
    y = years.to_numpy(dtype="float64", na_value=np.nan)[idx].clip(YEAR_MIN, YEAR_MAX)
    split = _artist_split(df["artist"])[idx]
    return x, y, split


def soft_targets(y: np.ndarray) -> np.ndarray:
    bin_pos = (y - YEAR_MIN) / BIN_YEARS - 0.5
    grid = np.arange(N_BINS, dtype=np.float64)
    logits = -((grid[None, :] - bin_pos[:, None]) ** 2) / (2 * TARGET_SIGMA_BINS**2)
    weights = np.exp(logits)
    return (weights / weights.sum(axis=1, keepdims=True)).astype(np.float32)


def sample_weights(y: np.ndarray) -> np.ndarray:
    bins = ((y - YEAR_MIN) // BIN_YEARS).astype(int)
    counts = np.bincount(bins, minlength=N_BINS).astype(np.float64)
    w = 1.0 / np.sqrt(np.clip(counts[bins], 1.0, None))
    return (w / w.mean()).astype(np.float32)


def evaluate(head: YearHead, x: np.ndarray, y: np.ndarray) -> dict:
    head.eval()
    preds = []
    with torch.inference_mode():
        for start in range(0, len(x), 4096):
            years, _ = head(torch.from_numpy(x[start : start + 4096]))
            preds.append(years.numpy())
    pred = np.concatenate(preds)
    err = np.abs(pred - y)
    per_century = {}
    for century in range(1300, 2100, 100):
        sel = (y >= century) & (y < century + 100)
        if sel.sum() >= 20:
            per_century[str(century)] = {"n": int(sel.sum()), "mae": round(float(err[sel].mean()), 1)}
    return {
        "n": int(len(y)),
        "mae": round(float(err.mean()), 1),
        "median_ae": round(float(np.median(err)), 1),
        "within_25y": round(float((err <= 25).mean()), 3),
        "within_50y": round(float((err <= 50).mean()), 3),
        "per_century_mae": per_century,
    }


def main() -> None:
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    torch.set_num_threads(max(1, torch.get_num_threads()))

    x, y, split = load_dataset()
    train, val, test = (split == 0), (split == 1), (split == 2)
    print(f"dataset: {len(y)} paintings | train {train.sum()} / val {val.sum()} / test {test.sum()} (artist-disjoint)")

    targets = soft_targets(y[train])
    weights = sample_weights(y[train])
    x_train = torch.from_numpy(x[train])
    t_train = torch.from_numpy(targets)
    w_train = torch.from_numpy(weights)

    mlp = YearMLP()
    head = YearHead(mlp, BIN_CENTERS)
    optimizer = torch.optim.AdamW(mlp.parameters(), lr=1e-3, weight_decay=1e-4)
    epochs, batch_size = 40, 2048
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    best_val_mae, best_state = float("inf"), None
    n = len(x_train)
    for epoch in range(epochs):
        mlp.train()
        order = torch.randperm(n)
        total_loss = 0.0
        for start in range(0, n, batch_size):
            batch = order[start : start + batch_size]
            logits = mlp(x_train[batch])
            log_probs = torch.log_softmax(logits, dim=-1)
            loss = (-(t_train[batch] * log_probs).sum(dim=-1) * w_train[batch]).mean()
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total_loss += float(loss) * len(batch)
        scheduler.step()
        val_mae = evaluate(head, x[val], y[val])["mae"]
        if val_mae < best_val_mae:
            best_val_mae = val_mae
            best_state = {k: v.clone() for k, v in mlp.state_dict().items()}
        print(f"epoch {epoch + 1:2d}/{epochs} loss {total_loss / n:.4f} val MAE {val_mae:.1f}y (best {best_val_mae:.1f}y)")

    mlp.load_state_dict(best_state)
    metrics = {
        "train_size": int(train.sum()),
        "val": evaluate(head, x[val], y[val]),
        "test": evaluate(head, x[test], y[test]),
        "baseline_test_mae_predict_median": round(float(np.abs(np.median(y[train]) - y[test]).mean()), 1),
        "bins": {"min": YEAR_MIN, "max": YEAR_MAX, "bin_years": BIN_YEARS, "n_bins": N_BINS},
        "split": "artist-disjoint 80/10/10 (sha256 of artist name)",
        "embedding_model": "openai/clip-vit-base-patch32 (L2-normalized image features)",
    }
    print(json.dumps(metrics["test"], indent=2))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    head.eval()
    scripted = torch.jit.script(head)
    scripted.save(str(OUT_DIR / "f5_year_head.pt"))
    with (OUT_DIR / "f5_year_head_metrics.json").open("w", encoding="utf-8") as fh:
        json.dump(metrics, fh, indent=2)
    print(f"saved {OUT_DIR / 'f5_year_head.pt'}")


if __name__ == "__main__":
    main()
