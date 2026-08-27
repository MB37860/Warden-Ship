# Training Runbook — the FRIDA SLURM cluster

> **Odstranjeno 26. 8. 2026.** Detektor objektov (YOLOv8, doučen na DEArt) je
> odstranjen iz aplikacije, cevovoda in diplome: njegov izhod v vmesniku ni imel
> nobenega instrumenta, odkar je bil junija izbrisan predal `CargoChestDrawers`.
> Meritve spodaj ostajajo kot zapis o tem, kar je bilo takrat izmerjeno.

Everything needed to train the new models on the FRIDA cluster, mirroring the
proven F2 job. **The moment you're back: log in, then run the blocks below.**
Each pipeline already has its own detailed README; this is the copy‑paste index.

- Account `lrv`, user `matej.breskvar`, partition `frida`, container
  `nvcr.io#nvidia/pytorch:24.10-py3`.
- Both **reuse the existing F2 dataset package**
  (`/shared/workspace/lrv/f2/wikiart_f2_trainpkg.tar`); no new upload needed.
- Every trainer was **smoke‑tested locally on CPU** before this was written
  (see each README's "Notes").

| # | Model | Helps | New data? | sbatch |
|---|-------|-------|-----------|--------|
| 1 | Art embedding (ArcFace) | F5 map (→F3/F4); no text tower, so not F1 search | no (reuses F2 pkg) | `training/f1_embedding/train_embed.sbatch` |
| 2 | ~~YOLOv8 fine‑tune (DEArt)~~ | ~~F6 objects~~ | — | odstranjeno, glej opombo zgoraj |
| 3 | CLIP contrastive (captions) | F1 typed search | no (reuses F2 pkg) | `training/f1_clip_finetune/train_clip.sbatch` |

## 0 · Log in
```bash
tsh --proxy=rdc.si --user=matej.breskvar --mfa-mode=otp --auth=local login
ssh login-frida.rdc.si        # sanity check
```

## 1 · Upload (one time, from the repo on this PC)
```bash
cd /home/matej/FAKS/3.letnik/OO/projekt1
ssh login-frida.rdc.si "mkdir -p /shared/workspace/lrv/{f1_embed,f1_clip}"

# Pipeline 1 — embedding (reuses F2 package already on the cluster)
tsh scp backend/training/f1_embedding/train_embed.py \
        backend/training/f1_embedding/train_embed.sbatch \
  matej.breskvar@login-frida.rdc.si:/shared/workspace/lrv/f1_embed/

# Pipeline 3 — CLIP (reuses F2 package)
tsh scp backend/training/f1_clip_finetune/train_clip.py \
        backend/training/f1_clip_finetune/captions.py \
        backend/training/f1_clip_finetune/train_clip.sbatch \
  matej.breskvar@login-frida.rdc.si:/shared/workspace/lrv/f1_clip/

# Pipeline 2 — YOLO: odstranjeno 26. 8. 2026 skupaj z imenikom
#   backend/f6_objects/. Ukazi za pripravo DEArt niso več izvedljivi.
```

## 2 · Submit (on the login node) — start both
```bash
ssh login-frida.rdc.si
( cd /shared/workspace/lrv/f1_embed   && sbatch train_embed.sbatch )
( cd /shared/workspace/lrv/f1_clip    && sbatch train_clip.sbatch  )

squeue --me                       # watch the queue
tail -f /shared/workspace/lrv/f1_embed/f1-embed_*.out     # p@1 / p@10
tail -f /shared/workspace/lrv/f1_clip/f1-clip_*.out       # zs_style / zs_genre
# scancel <jobid> to stop one
```

## 3 · Bring back + evaluate locally (after each finishes)
```bash
cd /home/matej/FAKS/3.letnik/OO/projekt1

# 1 — embedding
RUN=/shared/workspace/lrv/f2/runs/<jobid-embed>
tsh scp matej.breskvar@login-frida.rdc.si:$RUN/f1_embed_model.pt \
        matej.breskvar@login-frida.rdc.si:$RUN/f1_embed_labels.json data/f1_embed/
.venv/bin/python backend/training/f1_embedding/evaluate_embed.py \
  --model data/f1_embed/f1_embed_model.pt --labels data/f1_embed/f1_embed_labels.json \
  --test data/f2_dataset/test.jsonl --data-root data/f2_dataset --sample 2000

# 3 — CLIP (compare to baseline: style ~0.28, genre ~0.50)
RUN=/shared/workspace/lrv/f1_clip/runs/<jobid-clip>
tsh scp -r matej.breskvar@login-frida.rdc.si:$RUN/clip_art data/clip_art
.venv/bin/python backend/training/f1_clip_finetune/evaluate_clip.py \
  --model data/clip_art --test data/f2_dataset/test.jsonl \
  --data-root data/f2_dataset --labels data/f2_dataset/labels.json --sample 2000

```

## 4 · Wire into the app
Both surviving models are now picked up automatically — dropping the exported
artifact in the right directory is the whole wire‑in:

- **#3 CLIP** — `clip_service._resolve_model_name()` prefers `data/clip_art` over
  `openai/clip-vit-base-patch32` whenever that directory exists, and falls back
  to the base model if it fails to load.
- **#1 embedding** — the F5 pipeline's `_resolve_arcface_model()` looks for
  `data/f1_embed/f1_embed_model.pt` (override with `F5_EMBED_MODEL_PATH`) and
  uses it for the map's embeddings, falling back to stored CLIP vectors. F1's
  text search stays on CLIP: ArcFace is image‑only.

Neither artifact is staged into the Electron build (`build-python-runtime.mjs`
copies only `data/f5_year_head`), so a packaged desktop app runs the base CLIP.

See per‑pipeline READMEs for detail:
[`f1_embedding`](../backend/training/f1_embedding/README.md) ·
[`f1_clip_finetune`](../backend/training/f1_clip_finetune/README.md).
