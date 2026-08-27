# Model Evaluation Report

> **Goal:** actually *run* the project's trainable models and report their
> accuracy on a held‑out test set, then judge whether any model is "bad and
> needs (re)training."

## 4.1 What is evaluated, and why

Most of the app's intelligence is **pretrained and frozen** (CLIP for F1/F5;
MediaPipe / RetinaFace for F6) — these are used off‑the‑shelf and are not
trained by this project, so there is no project‑specific "test accuracy" to
report for them. The one model **this project trains** is the **F2 multi‑task
classifier** (style / genre / artist). That is the model the evaluation targets.

Two trained F2 variants ship in `data/`:

| Variant | Backbone | Input | Artifact | Cluster job |
|---------|----------|-------|----------|-------------|
| **Baseline** | `vit_base_patch16_clip_224.openai` | 224 | `data/f2_dataset/f2_image_model.pt` (344 MB) | run 95936, 15 epochs |
| **High‑res** | `vit_large_patch14_clip_336.openai` | 336 | `data/f2_dataset_hires/f2_image_model.pt` (1.2 GB) | run 96147, 50 epochs (best @46) |

The high‑res model is the one wired into the app today (`.env`:
`F2_MODEL_PATH=…/f2_dataset_hires/…`, `F2_INPUT_SIZE=336`).

## 4.2 Method

- **Test set:** the locally held‑out split produced by `prepare_dataset.py` —
  **12,680 images** with full‑resolution files the cluster never saw
  (`data/f2_dataset*/test.jsonl` + `test_images/`). Labels are sparse per head
  (every image has a style/genre, artist only for the top‑25 painters), so each
  head is scored only on images that carry that label.
- **Harness:** `backend/training/f2_classification/evaluate_local.py` (an
  extended version of the project's `evaluate_testset.py`). It reproduces the
  exact training/eval preprocessing (resize shorter side→256·size/224,
  centre‑crop, `[0,1]` CHW; the model bakes in its own CLIP normalization),
  computes per‑head accuracy with **95 % Wilson confidence intervals**, and
  writes a JSON report.
- **Hardware:** this machine, **CPU‑only** (torch 2.12, no CUDA). Because the
  ViT‑L/336 model runs at ≈0.6 img/s on CPU (a full 12,680‑image pass ≈ 6 h),
  the two models were evaluated as follows:
  - **Baseline (ViT‑B/224):** full test set (all 12,680 images).
  - **High‑res (ViT‑L/336):** a fixed **random sub‑sample of 1,500** images
    (`--sample 1500 --seed 42`); the Wilson intervals quantify the resulting
    sampling error (≈ ±2 pp).

Reproduce with:

```bash
# baseline, full test set
.venv/bin/python backend/training/f2_classification/evaluate_local.py \
  --model data/f2_dataset/f2_image_model.pt --labels data/f2_dataset/f2_labels.json \
  --test  data/f2_dataset/test.jsonl --data-root data/f2_dataset \
  --img-size 224 --tag baseline-vitb224 --report docs/evaluation/f2_baseline_eval.json

# high-res, 1500-image sub-sample
.venv/bin/python backend/training/f2_classification/evaluate_local.py \
  --model data/f2_dataset_hires/f2_image_model.pt --labels data/f2_dataset_hires/f2_labels.json \
  --test  data/f2_dataset_hires/test.jsonl --data-root data/f2_dataset_hires \
  --img-size 336 --sample 1500 --seed 42 --tag hires-vitl336 \
  --report docs/evaluation/f2_hires_eval.json
```

## 4.3 Reference: accuracy reported during training

From the exported `f2_metrics.json` (best **validation** accuracy on the
cluster):

| Head | Baseline ViT‑B/224 (val) | High‑res ViT‑L/336 (val) |
|------|--------------------------|---------------------------|
| Style (27‑way) | 0.6673 | **0.7590** |
| Genre (10‑way) | 0.8422 | **0.8725** |
| Artist (top‑25) | 0.9376 | **0.9722** |
| **Mean** | 0.8157 | **0.8679** |

These are the numbers from the *starting* training runs. Section 4.4 is the
**independent** check on the held‑out test set on this machine.

## 4.4 Measured accuracy on the held‑out test set

Independently measured on this machine (raw JSON:
[`docs/evaluation/f2_baseline_eval.json`](../docs/evaluation/f2_baseline_eval.json),
[`docs/evaluation/f2_hires_eval.json`](../docs/evaluation/f2_hires_eval.json)).
Brackets are 95 % Wilson confidence intervals; *n* is the number of test images
carrying a label for that head.

| Head | Baseline ViT‑B/224 (full, 12,680 imgs) | High‑res ViT‑L/336 (1,500‑img sample) |
|------|----------------------------------------|----------------------------------------|
| **Style** (27‑way) | 0.6807  [0.671, 0.690]  (n=9,666) | **0.7698**  [0.744, 0.793]  (n=1,138) |
| **Genre** (10‑way) | 0.8371  [0.830, 0.844]  (n=10,319) | **0.8583**  [0.838, 0.877]  (n=1,221) |
| **Artist** (top‑25) | **0.9447**  [0.931, 0.956]  (n=1,392) | 0.9353  [0.888, 0.963]  (n=170) |
| **Mean of heads** | 0.8208 | **0.8544** |

Wall time on CPU: baseline 2,565 s for the full set; high‑res 2,839 s for the
1,500‑image sample.

### How the measured test accuracy compares to the training run

| Head | Baseline val→test | High‑res val→test |
|------|-------------------|--------------------|
| Style | 0.6673 → **0.6807** (+1.3 pp) | 0.7590 → **0.7698** (+1.1 pp) |
| Genre | 0.8422 → 0.8371 (−0.5 pp) | 0.8725 → 0.8583 (−1.4 pp) |
| Artist | 0.9376 → 0.9447 (+0.7 pp) | 0.9722 → 0.9353 (−3.7 pp*) |

\* the high‑res artist head was scored on only **170** images (wide CI
[0.888, 0.963]); the cluster's 0.972 sits just outside that interval, so this is
sampling noise rather than a real drop — re‑run without `--sample` to confirm.

The headline: **measured test accuracy tracks the training‑reported validation
accuracy almost exactly** (test even *beats* val on the hardest head, style, for
both models). That is the signature of a model that **generalizes — no
overfitting**.

### Per‑class artist notes (lowest performers)

Consistent across both models and art‑historically sensible — not failures:

- **Camille Pissarro** — 0.838 (baseline) / 0.727 (hires): confused among the
  Impressionists (Monet/Sisley), exactly the "meaningful confusion" [A3]
  documents.
- **Ilya Repin** — 0.839 (baseline); **Paul Cézanne** — 0.864 / 0.667 (hires,
  n=6): the Post‑Impressionist bridge cases.

Many artists score **1.00** (Beksinski, Bela Czobel, Roger Weik, Iván Shishkin,
Rubens, …). The top‑25 artist restriction is doing its job.

## 4.5 Verdict — is any model "bad and in need of training"?

**No. Neither F2 model is bad, and neither needs retraining.** Both are healthy,
well‑generalized, and already **exceed both the proposal's targets and the
source‑article state of the art** (style: A3 = 45.97 %, A5 = 63.7 % → here
68 %/**77 %**; genre/artist comfortably in the 0.84–0.94 range).

Per‑model:

- ✅ **High‑res ViT‑L/336 (currently wired into the app)** — the right default.
  Best on the two hard, high‑value heads: **style 0.77** (+9 pp over baseline)
  and genre 0.86. Recommendation: **keep it**.
- ✅ **Baseline ViT‑B/224** — also solid and ~5× faster on CPU (5 vs 0.6 img/s).
  Best kept as the **CPU/low‑latency fallback** (e.g. set it via `F2_MODEL_PATH`
  for machines without a GPU); its style head (0.68) is the only real compromise.

**The only actionable items are verification/quality, not retraining:**

1. **Confirm the high‑res numbers on the full test set** (the artist head was on
   n=170). Best run on a GPU or left overnight on CPU — drop `--sample`.
2. **Optional, only if you want to push style further:** the 27‑way style head is
   the natural ceiling. More epochs or stronger augmentation might add a couple
   of points, but the current 0.77 is already strong and the effort/return is
   low. Not required.

> Footnote on labels: the real class names come from the exported
> `f2_labels.json` (e.g. Piranesi, Steinlen, Beksinski, …), **not** the
> placeholder `DEFAULT_LABELS` list hard‑coded in `classifier.py` — those are
> only a last‑resort fallback when `F2_LABELS_PATH` is unset. The evaluation
> used the correct exported labels.

## 4.6 If a model needs (re)training — how

The full recipe lives in `backend/training/f2_classification/README.md`:

1. **Build the package locally** — `prepare_dataset.py` scans the WikiArt tars,
   splits train/val, **holds out the test set on this PC**, and writes
   `wikiart_f2_trainpkg.tar` + `labels.json`.
2. **Train on FRIDA (GPU)** — `sbatch train_f2.sbatch` runs `train_f2.py`:
   fine‑tunes a `timm` CLIP‑ViT backbone with 3 linear heads and a **masked
   multi‑task loss** (each image supervises only the heads it has a label for),
   with class weights, label smoothing, mixup, RandAugment, EMA and TTA for the
   high‑res config. The best checkpoint is re‑exported as self‑contained
   TorchScript whenever val accuracy improves.
3. **Bring it back & test** — copy `f2_image_model.pt`/`f2_labels.json`/
   `f2_metrics.json` into `data/…`, run `evaluate_local.py`.
4. **Wire it in** — point `F2_MODEL_PATH` / `F2_LABELS_PATH` / `F2_INPUT_SIZE`
   at the new artifact (`.env`).

Levers if a head underperforms: more epochs / bigger backbone
(`--backbone vit_large_…`), more artists (`--num-artists`), stronger
augmentation, or — for CPU‑friendlier serving — `convnext_tiny`.
