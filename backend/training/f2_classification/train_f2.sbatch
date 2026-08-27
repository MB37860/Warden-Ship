#!/bin/bash
# =====================================================================
# FRIDA SLURM job: fine-tune the F2 multi-task art classifier.
#
# FRIDA has NO modules and NO conda/venv on the login node — all compute
# runs inside an Enroot/Pyxis container (NVIDIA PyTorch). See:
#   https://docs.rdc.si/FRIDA/slurm/
#
# Account/paths are filled in for user matej.breskvar (account "lrv").
# Submit from the login node with:  sbatch train_f2.sbatch
# =====================================================================
#SBATCH --job-name=f2-train
#SBATCH --partition=frida
#SBATCH --account=lrv
#SBATCH --gres=gpu:A100:1
#SBATCH --cpus-per-task=16
#SBATCH --mem=64G
#SBATCH --time=08:00:00
#SBATCH --output=%x_%j.out

set -euo pipefail

# --- Paths on shared storage (hardcoded: $WORK/$SCRATCH are not exported here) ---
PROJECT_DIR="/shared/workspace/lrv/f2"          # holds code + dataset + outputs
PACKAGE_TAR="$PROJECT_DIR/wikiart_f2_trainpkg.tar"
DATA_DIR="${SCRATCH:-/local/scratch/$USER/$SLURM_JOB_ID}/f2_data"  # fast raid0 scratch
OUT_DIR="$PROJECT_DIR/runs/$SLURM_JOB_ID"
CACHE_DIR="$PROJECT_DIR/.cache"

CONTAINER="nvcr.io#nvidia/pytorch:24.10-py3"

mkdir -p "$DATA_DIR" "$OUT_DIR" "$CACHE_DIR"

# Stage the dataset onto fast scratch (idempotent: skip if already extracted).
if [ ! -f "$DATA_DIR/labels.json" ]; then
  echo "Extracting dataset package to scratch ..."
  tar -xf "$PACKAGE_TAR" -C "$DATA_DIR"
fi

# Cache pip + HF/torch model weights on shared storage so re-runs are fast/offline.
export PIP_CACHE_DIR="$CACHE_DIR/pip"
export HF_HOME="$CACHE_DIR/huggingface"
export TORCH_HOME="$CACHE_DIR/torch"
mkdir -p "$PIP_CACHE_DIR" "$HF_HOME" "$TORCH_HOME"

srun \
  --container-image="$CONTAINER" \
  --container-mounts="/shared/workspace/lrv:/shared/workspace/lrv" \
  --container-workdir="$PROJECT_DIR" \
  bash -c '
    set -euo pipefail
    export PIP_CACHE_DIR="'"$PIP_CACHE_DIR"'" HF_HOME="'"$HF_HOME"'" TORCH_HOME="'"$TORCH_HOME"'"
    pip install --no-cache-dir "timm==1.0.11"
    python train_f2.py \
      --data-dir "'"$DATA_DIR"'" \
      --out-dir  "'"$OUT_DIR"'" \
      --backbone vit_base_patch16_clip_224.openai \
      --epochs 15 \
      --batch-size 128 \
      --num-workers 16
  '

echo "Done. Artifacts in: $OUT_DIR"
ls -la "$OUT_DIR"
