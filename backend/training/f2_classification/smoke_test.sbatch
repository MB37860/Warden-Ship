#!/bin/bash
# Quick validation of the upgraded train_f2.py (mixup/EMA/RandAugment/bf16/
# grad-checkpointing) in the real container. 1 epoch on the small package.
#SBATCH --job-name=f2-smoke
#SBATCH --partition=dev
#SBATCH --account=lrv
#SBATCH --gres=gpu:A100:1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=00:30:00
#SBATCH --output=%x_%j.out

set -euo pipefail
PROJECT_DIR="/shared/workspace/lrv/f2"
DATA_DIR="${SCRATCH:-/local/scratch/$USER/$SLURM_JOB_ID}/f2_smoke"
OUT_DIR="$PROJECT_DIR/runs/smoke_$SLURM_JOB_ID"
CACHE_DIR="$PROJECT_DIR/.cache"
CONTAINER="nvcr.io#nvidia/pytorch:24.10-py3"
mkdir -p "$DATA_DIR" "$OUT_DIR" "$CACHE_DIR"
[ -f "$DATA_DIR/labels.json" ] || tar -xf "$PROJECT_DIR/wikiart_f2_trainpkg.tar" -C "$DATA_DIR"
export PIP_CACHE_DIR="$CACHE_DIR/pip" HF_HOME="$CACHE_DIR/huggingface" TORCH_HOME="$CACHE_DIR/torch"
mkdir -p "$PIP_CACHE_DIR" "$HF_HOME" "$TORCH_HOME"

srun --container-image="$CONTAINER" \
  --container-mounts="/shared/workspace/lrv:/shared/workspace/lrv" \
  --container-workdir="$PROJECT_DIR" \
  bash -c '
    set -euo pipefail
    export PIP_CACHE_DIR="'"$PIP_CACHE_DIR"'" HF_HOME="'"$HF_HOME"'" TORCH_HOME="'"$TORCH_HOME"'"
    pip install --no-cache-dir "timm==1.0.11"
    python train_f2.py --data-dir "'"$DATA_DIR"'" --out-dir "'"$OUT_DIR"'" \
      --backbone vit_base_patch16_clip_224.openai --img-size 224 \
      --epochs 1 --batch-size 32 --label-smoothing 0.1 --mixup-alpha 0.2 \
      --randaug --ema --tta --amp-dtype bf16 --grad-checkpointing --num-workers 8
  '
echo "SMOKE DONE"; ls -la "$OUT_DIR"
