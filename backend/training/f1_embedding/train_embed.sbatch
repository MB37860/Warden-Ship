#!/bin/bash
# =====================================================================
# FRIDA SLURM job: train the art-tuned F1/F5 embedding (ArcFace metric
# learning). Reuses the F2 dataset package (no new data prep).
#
# Mirrors training/f2_classification/train_f2.sbatch. Account/paths are
# filled in for user matej.breskvar / account "lrv".
# Submit from the login node:  sbatch train_embed.sbatch
# =====================================================================
#SBATCH --job-name=f1-embed
#SBATCH --partition=frida
#SBATCH --account=lrv
#SBATCH --gres=gpu:A100:1
#SBATCH --cpus-per-task=16
#SBATCH --mem=64G
#SBATCH --time=12:00:00
#SBATCH --output=%x_%j.out

set -euo pipefail

# Reuse the F2 project dir + dataset package on shared storage.
PROJECT_DIR="/shared/workspace/lrv/f2"
PACKAGE_TAR="$PROJECT_DIR/wikiart_f2_trainpkg.tar"
DATA_DIR="${SCRATCH:-/local/scratch/$USER/$SLURM_JOB_ID}/f2_data"
OUT_DIR="$PROJECT_DIR/runs/$SLURM_JOB_ID"
CACHE_DIR="$PROJECT_DIR/.cache"
CONTAINER="nvcr.io#nvidia/pytorch:24.10-py3"

mkdir -p "$DATA_DIR" "$OUT_DIR" "$CACHE_DIR"

if [ ! -f "$DATA_DIR/labels.json" ]; then
  echo "Extracting dataset package to scratch ..."
  tar -xf "$PACKAGE_TAR" -C "$DATA_DIR"
fi

export PIP_CACHE_DIR="$CACHE_DIR/pip"
export HF_HOME="$CACHE_DIR/huggingface"
export TORCH_HOME="$CACHE_DIR/torch"
mkdir -p "$PIP_CACHE_DIR" "$HF_HOME" "$TORCH_HOME"

# Copy the trainer next to the package on shared storage before submitting:
#   tsh scp backend/training/f1_embedding/train_embed.py \
#           matej.breskvar@login-frida.rdc.si:/shared/workspace/lrv/f1_embed/
srun \
  --container-image="$CONTAINER" \
  --container-mounts="/shared/workspace/lrv:/shared/workspace/lrv" \
  --container-workdir="/shared/workspace/lrv/f1_embed" \
  bash -c '
    set -euo pipefail
    export PIP_CACHE_DIR="'"$PIP_CACHE_DIR"'" HF_HOME="'"$HF_HOME"'" TORCH_HOME="'"$TORCH_HOME"'"
    pip install --no-cache-dir "timm==1.0.11"
    python train_embed.py \
      --data-dir "'"$DATA_DIR"'" \
      --out-dir  "'"$OUT_DIR"'" \
      --backbone vit_base_patch16_clip_224.openai \
      --label style \
      --embed-dim 512 \
      --epochs 20 \
      --batch-size 128 \
      --lr-head 5e-4 \
      --lr-backbone 1e-5 \
      --warmup-epochs 1 \
      --arc-scale 30 \
      --arc-margin 0.3 \
      --grad-clip 1.0 \
      --ema \
      --amp-dtype bf16 \
      --num-workers 16
  '

echo "Done. Artifacts in: $OUT_DIR"
ls -la "$OUT_DIR"
