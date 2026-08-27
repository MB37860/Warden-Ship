#!/bin/bash
# =====================================================================
# FRIDA SLURM job: HIGH-ACCURACY F2 run to push STYLE accuracy.
#   CLIP ViT-L/14 @ 336px, 50 epochs, label smoothing + mixup + RandAugment
#   + EMA + hflip TTA. Needs an 80GB GPU (H100). Uses the 384px hi-res package.
#
# Submit:  sbatch train_f2_hires.sbatch
# =====================================================================
#SBATCH --job-name=f2-hires
#SBATCH --partition=frida
#SBATCH --account=lrv
#SBATCH --gres=gpu:A100:1
#SBATCH --cpus-per-task=16
#SBATCH --mem=64G
#SBATCH --time=24:00:00
#SBATCH --output=%x_%j.out

set -euo pipefail

PROJECT_DIR="/shared/workspace/lrv/f2"
PACKAGE_TAR="$PROJECT_DIR/wikiart_f2_trainpkg_hires.tar"
DATA_DIR="${SCRATCH:-/local/scratch/$USER/$SLURM_JOB_ID}/f2_data_hires"
OUT_DIR="$PROJECT_DIR/runs/$SLURM_JOB_ID"
CACHE_DIR="$PROJECT_DIR/.cache"
CONTAINER="nvcr.io#nvidia/pytorch:24.10-py3"

mkdir -p "$DATA_DIR" "$OUT_DIR" "$CACHE_DIR"

if [ ! -f "$DATA_DIR/labels.json" ]; then
  echo "Extracting hi-res dataset package to scratch ..."
  tar -xf "$PACKAGE_TAR" -C "$DATA_DIR"
fi

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
      --backbone vit_large_patch14_clip_336.openai \
      --img-size 336 \
      --epochs 50 \
      --batch-size 32 \
      --grad-accum 3 \
      --lr-head 1e-3 \
      --lr-backbone 8e-6 \
      --warmup-epochs 3 \
      --label-smoothing 0.1 \
      --mixup-alpha 0.2 \
      --randaug \
      --ema \
      --tta \
      --amp-dtype bf16 \
      --grad-checkpointing \
      --num-workers 16
  '

echo "Done. Artifacts in: $OUT_DIR"
ls -la "$OUT_DIR"
