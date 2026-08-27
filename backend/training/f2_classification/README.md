# F2 Classifier — Training Pipeline (style / genre / artist)

End-to-end recipe to train the Feature-2 multi-task classifier on the **FRIDA**
SLURM cluster and deploy it back into the app, while keeping a **held-out test
set on this PC**.

## What this trains

A single model with three heads:

| Head   | Classes | Source |
|--------|---------|--------|
| Style  | canonical 27 (mapped from raw WikiArt) | `taxonomy.CANONICAL_STYLES` |
| Genre  | canonical 10 (mapped from raw WikiArt) | `taxonomy.CANONICAL_GENRES` |
| Artist | top-K most frequent (default 25)        | data-driven in `prepare_dataset.py` |

**Why this design (vs. the old plan):** the previous `train_clip_heads.py` only
trained a linear head on *frozen* CLIP-B/32 features → mediocre style accuracy.
Here we **fine-tune the whole network** (a CLIP-pretrained ViT-B/16 from `timm`)
with a **masked multi-task loss**: every image supervises only the heads whose
label it actually has, so each task uses the maximum amount of data. Artists are
restricted to the top-K most frequent painters for high accuracy (as you asked).

Expected ballpark on the held-out test set: genre ~0.80+, artist (top-25) ~0.85+,
style (27-way, intrinsically hard) ~0.62–0.70 depending on epochs/backbone.

---

## Files

| File | Runs where | Purpose |
|------|-----------|---------|
| `taxonomy.py` | local | raw→canonical label mapping |
| `prepare_dataset.py` | **local PC** | scan tars, split, build upload package, **hold out test set here** |
| `train_f2.py` | **cluster (container)** | fine-tune + export TorchScript |
| `train_f2.sbatch` | **cluster login node** | SLURM job (Enroot/Pyxis container) |
| `evaluate_testset.py` | **local PC** | score the model on the local test set |
| `requirements-train.txt` | — | `timm` (installed in the container) |

---

## Step 0 — One-time setup

Install the Teleport client `tsh` (Community Edition) and log in
(per <https://docs.rdc.si/FRIDA/access/>):

```bash
tsh --proxy=rdc.si --user=YOUR_USER --mfa-mode=otp --auth=local login
ssh login-frida.rdc.si    # sanity check you can reach the login node
```

> Replace `YOUR_USER` everywhere below with your Teleport username, and
> `YOUR_ACCOUNT` with your SLURM account (the `--account` value; it also names
> your `$WORK` workspace `/shared/workspace/YOUR_ACCOUNT`).

---

## Step 1 — Build the dataset package (local, ~30–60 min, one-time)

This reads your existing `data/WikiArt_dataset/*.tar` (104 GB), resizes the
train/val images small for upload, and **keeps the full-resolution test images
on this machine**. No GPU needed.

```bash
cd /home/matej/FAKS/3.letnik/OO/projekt1
.venv/bin/python backend/f2_classification/training/prepare_dataset.py
```

Useful knobs (defaults shown):

```bash
.venv/bin/python backend/f2_classification/training/prepare_dataset.py \
  --test-frac 0.08 --val-frac 0.08 \
  --num-artists 25 --min-artist-count 120 \
  --max-per-style 7000 --train-size 256
```

Outputs under `data/f2_dataset/`:

```
wikiart_f2_trainpkg.tar   <-- upload THIS (a few GB)
test_images/<key>.jpg     <-- held-out test images, STAY on this PC
test.jsonl                <-- their labels
train.jsonl / val.jsonl / labels.json / dataset_stats.json
```

> Tip: do a quick dry run first with `--limit-tars 1` to confirm everything
> works before the full pass.

---

## Step 2 — Upload code + data to the cluster

`$WORK` = `/shared/workspace/YOUR_ACCOUNT`. Create the project dir and copy the
package + the training script (only two things are needed on the cluster):

```bash
ssh login-frida.rdc.si "mkdir -p /shared/workspace/YOUR_ACCOUNT/f2"

# dataset package (a few GB)
tsh scp data/f2_dataset/wikiart_f2_trainpkg.tar \
  YOUR_USER@login-frida.rdc.si:/shared/workspace/YOUR_ACCOUNT/f2/

# training script + sbatch
tsh scp backend/f2_classification/training/train_f2.py \
        backend/f2_classification/training/train_f2.sbatch \
  YOUR_USER@login-frida.rdc.si:/shared/workspace/YOUR_ACCOUNT/f2/
```

(`scp -r ... login-frida.rdc.si:...` also works once you've added `tsh config`
output to your `~/.ssh/config`.)

---

## Step 3 — Edit two lines, then launch (this is the "one command")

Edit `train_f2.sbatch` (the two `<< EDIT >>` lines): set `--account=YOUR_ACCOUNT`
and, if you want a specific GPU, `--gres=gpu:H100:1` etc. Then:

```bash
ssh login-frida.rdc.si
cd /shared/workspace/YOUR_ACCOUNT/f2
sbatch train_f2.sbatch          # <-- starts training on the cluster
```

The job (see `train_f2.sbatch`): unpacks the dataset to fast `$SCRATCH`, pulls
the `nvcr.io#nvidia/pytorch` container, `pip install`s `timm`, and runs
`train_f2.py`. Artifacts land in `$WORK/f2/runs/<jobid>/`.

### Monitor

```bash
squeue --me
tail -f f2-train_<jobid>.out          # live log (style/genre/artist acc per epoch)
frida                                  # cluster + your recent jobs + storage
scancel <jobid>                        # cancel if needed
```

---

## Step 4 — Bring the model back and test it locally

```bash
RUN=/shared/workspace/YOUR_ACCOUNT/f2/runs/<jobid>
tsh scp YOUR_USER@login-frida.rdc.si:$RUN/f2_image_model.pt \
        YOUR_USER@login-frida.rdc.si:$RUN/f2_labels.json \
        YOUR_USER@login-frida.rdc.si:$RUN/f2_metrics.json \
  data/f2_dataset/

.venv/bin/python backend/f2_classification/training/evaluate_testset.py
```

This scores the model on images the cluster **never saw**.

---

## Step 5 — Wire it into the app

Point the F2 runtime at the new self-contained image model:

```bash
export F2_MODEL_KIND=image
export F2_MODEL_PATH=/home/matej/FAKS/3.letnik/OO/projekt1/data/f2_dataset/f2_image_model.pt
export F2_LABELS_PATH=/home/matej/FAKS/3.letnik/OO/projekt1/data/f2_dataset/f2_labels.json
# optional: export F2_MODEL_DEVICE=cuda
```

The model is self-contained (it bakes in its own normalisation and outputs
`(style, genre, artist)` logits), so `classifier.py` feeds it the `[0,1]` tensor
from `_preprocess_image` — no other change needed.

---

## Tuning / troubleshooting

- **Faster iteration:** add `--freeze-backbone` to the `python train_f2.py` line
  in the sbatch for a quick linear-probe baseline.
- **Higher accuracy:** more `--epochs`, or a bigger backbone, e.g.
  `--backbone vit_large_patch14_clip_224.openai` (needs more GPU memory →
  lower `--batch-size`, request `gpu:A100_80GB:1` or `gpu:H100:1`).
- **Lighter/CPU-friendlier inference** in the app:
  `--backbone convnext_tiny.fb_in22k_ft_in1k`.
- **More/fewer authors:** re-run Step 1 with `--num-artists N`.
- **No internet on compute nodes?** Pre-fetch weights once on the `dev`
  partition (`srun -p dev --gres=gpu:A100 --pty ...`) into `$HF_HOME` /
  `$TORCH_HOME` (already pointed at `$WORK/.cache` by the sbatch); subsequent
  runs are offline.
- **Out of time:** raise `#SBATCH --time` (max 7d on `frida`); the model is
  re-exported every time val accuracy improves, so a killed job still leaves the
  best checkpoint in `runs/<jobid>/`.
