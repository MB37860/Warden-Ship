# F1 CLIP — Training Pipeline (contrastive fine-tune on art captions)

Fine-tunes CLIP on `(painting, caption)` pairs built from WikiArt metadata so
both encoders speak *art* — improving F1 typed search ("a stormy seascape at
dusk"). Exports a **standard HF CLIP directory**, so the backend loads it
unchanged (it's the same `CLIPModel.from_pretrained` the app already uses).

**Reuses the F2 dataset package** — no new data prep. Captions come from
`captions.build_caption` (shared by trainer + evaluator).

## Files
| File | Runs where | Purpose |
|------|-----------|---------|
| `captions.py` | both | caption template from style/genre/artist |
| `train_clip.py` | cluster (container) | symmetric InfoNCE fine-tune; export HF CLIP dir |
| `train_clip.sbatch` | cluster login node | SLURM job |
| `evaluate_clip.py` | local PC | zero-shot style/genre accuracy on the held-out test set |

## Baseline to beat (measured locally)
Generic `openai/clip-vit-base-patch32`, zero-shot on the held-out test set:
**style ≈ 0.28, genre ≈ 0.50**. The fine-tune should lift both.

## Run on FRIDA
```bash
ssh login-frida.rdc.si "mkdir -p /shared/workspace/lrv/f1_clip"
tsh scp backend/f1_clip_finetune/training/train_clip.py \
        backend/f1_clip_finetune/training/captions.py \
        backend/f1_clip_finetune/training/train_clip.sbatch \
  matej.breskvar@login-frida.rdc.si:/shared/workspace/lrv/f1_clip/

ssh login-frida.rdc.si
cd /shared/workspace/lrv/f1_clip
sbatch train_clip.sbatch
squeue --me ; tail -f f1-clip_*.out       # zs_style / zs_genre per epoch
```
Output: `/shared/workspace/lrv/f1_clip/runs/<jobid>/clip_art/` (HF CLIP dir).

## Bring back, evaluate, wire in
```bash
RUN=/shared/workspace/lrv/f1_clip/runs/<jobid>
tsh scp -r matej.breskvar@login-frida.rdc.si:$RUN/clip_art data/clip_art

# compare against baseline on the test set
.venv/bin/python backend/f1_clip_finetune/training/evaluate_clip.py \
  --model data/clip_art --test data/f2_dataset/test.jsonl \
  --data-root data/f2_dataset --labels data/f2_dataset/labels.json --sample 2000
```
To use it in the app, point the CLIP runtime at the local dir — in
`api/clip_service.py`, `_get_runtime(model_name=…)` already takes a model name,
so pass `data/clip_art` (e.g. via an env var) instead of the hub id.

## Notes
- Trainer + evaluator + export→reload round-trip were smoke-tested locally on CPU
  against the cached CLIP weights (1 epoch, 32 images) and produced a loadable
  HF CLIP dir.
- `_embeds()` handles both old (tensor) and new (`transformers>=5`, output object)
  `get_*_features` return types — matching `clip_service._feature_tensor`.
