#!/bin/bash
# =====================================================================
# FRIDA SLURM job: contrastively fine-tune CLIP on WikiArt art captions.
# Reuses the F2 dataset package. Mirrors the F2 job structure.
#
# Upload before submitting:
#   tsh scp backend/training/f1_clip_finetune/{train_clip.py,captions.py,train_clip.sbatch} \
#       matej.breskvar@login-frida.rdc.si:/shared/workspace/lrv/f1_clip/
# Submit:  sbatch train_clip.sbatch
# =====================================================================
#SBATCH --job-name=f1-clip
#SBATCH --partition=frida
#SBATCH --account=lrv
#SBATCH --gres=gpu:A100:1
#SBATCH --cpus-per-task=16
#SBATCH --mem=64G
#SBATCH --time=12:00:00
#SBATCH --output=%x_%j.out

set -euo pipefail

PROJECT_DIR="/shared/workspace/lrv/f2"          # reuse the F2 dataset package
CODE_DIR="/shared/workspace/lrv/f1_clip"        # train_clip.py + captions.py live here
PACKAGE_TAR="$PROJECT_DIR/wikiart_f2_trainpkg.tar"
DATA_DIR="${SCRATCH:-/local/scratch/$USER/$SLURM_JOB_ID}/f2_data"
OUT_DIR="$CODE_DIR/runs/$SLURM_JOB_ID"
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

srun \
  --container-image="$CONTAINER" \
  --container-mounts="/shared/workspace/lrv:/shared/workspace/lrv" \
  --container-workdir="$CODE_DIR" \
  bash -c '
    set -euo pipefail
    export PIP_CACHE_DIR="'"$PIP_CACHE_DIR"'" HF_HOME="'"$HF_HOME"'" TORCH_HOME="'"$TORCH_HOME"'"
    pip install --no-cache-dir "transformers>=4.40" pillow
    python train_clip.py \
      --data-dir "'"$DATA_DIR"'" \
      --out-dir  "'"$OUT_DIR"'" \
      --model-name openai/clip-vit-base-patch32 \
      --epochs 10 \
      --batch-size 256 \
      --lr 3e-6 \
      --warmup-epochs 1 \
      --num-workers 16
  '

echo "Done. Fine-tuned CLIP in: $OUT_DIR/clip_art"
ls -la "$OUT_DIR/clip_art" || true
