# F1/F5 Embedding — Training Pipeline (ArcFace metric learning)

Trains an **art-tuned image embedding** so paintings of the same style/artist sit
close together — directly improving F1 (Star Atlas search) and F5 (history map),
and therefore the F3/F4 views derived from F5. Replaces the generic CLIP ViT-B/32
embedding currently used for retrieval.

**Reuses the F2 dataset package** (`wikiart_f2_trainpkg.tar`) — no new data prep.

## Files
| File | Runs where | Purpose |
|------|-----------|---------|
| `train_embed.py` | cluster (container) | fine-tune backbone + projection with an ArcFace head; export TorchScript embedding |
| `train_embed.sbatch` | cluster login node | SLURM job (Enroot/Pyxis container) |
| `evaluate_embed.py` | local PC | kNN retrieval (style/artist precision@1/@k) on the held-out test set |

## Run on FRIDA
```bash
# one-time: put the trainer next to the reused F2 package on shared storage
ssh login-frida.rdc.si "mkdir -p /shared/workspace/lrv/f1_embed"
tsh scp backend/f1_embedding/training/train_embed.py \
        backend/f1_embedding/training/train_embed.sbatch \
  matej.breskvar@login-frida.rdc.si:/shared/workspace/lrv/f1_embed/

# submit
ssh login-frida.rdc.si
cd /shared/workspace/lrv/f1_embed
sbatch train_embed.sbatch
squeue --me ; tail -f f1-embed_*.out      # p@1 / p@10 per epoch
```
Artifacts land in `/shared/workspace/lrv/f2/runs/<jobid>/`:
`f1_embed_model.pt`, `f1_embed_labels.json`, `f1_embed_metrics.json`.

## Bring back & evaluate locally
```bash
RUN=/shared/workspace/lrv/f2/runs/<jobid>
tsh scp matej.breskvar@login-frida.rdc.si:$RUN/f1_embed_model.pt \
        matej.breskvar@login-frida.rdc.si:$RUN/f1_embed_labels.json \
  data/f1_embed/
.venv/bin/python backend/f1_embedding/training/evaluate_embed.py \
  --model data/f1_embed/f1_embed_model.pt --labels data/f1_embed/f1_embed_labels.json \
  --test data/f2_dataset/test.jsonl --data-root data/f2_dataset --sample 2000
```

## Wire it into the app
The exported model takes a `[0,1]` image tensor and returns an L2-normalised
embedding (normalisation baked in) — the same contract `clip_service.py`
produces. To use it for F1/F5, load it in a small embedding service and swap it
in where `embed_images` is called (image-side). Text-side search (F1 typed
queries) still needs a text encoder — keep CLIP for text, or use pipeline #3
(`f1_clip_finetune`) to get a matched art-tuned text encoder.

## Notes
- Default supervision is `--label style` (27 classes). `--label artist` makes the
  space cluster by painter instead.
- Smoke-tested locally on CPU with `--no-pretrained --backbone vit_tiny_patch16_224
  --limit-train 64`. The real run uses the CLIP ViT-B/16 backbone, pretrained.
