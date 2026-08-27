# Documentation

| Document | What it covers |
|---|---|
| [thesis.pdf](thesis.pdf) | The complete bachelor's thesis (Slovene, with an English abstract). |
| [concept-and-frontend.md](concept-and-frontend.md) | The idea behind the app, the cinematic voyage, and every scene and element of the frontend. |
| [backend-architecture.md](backend-architecture.md) | The Flask service, the data layer (MongoDB + GridFS), the pipeline runner, the CLIP service, and all REST endpoints. |
| [features.md](features.md) | The feature catalogue F1–F6, element by element, with the model or algorithm behind each. |
| [model-evaluation.md](model-evaluation.md) | How the models were evaluated on the 12,680-image held-out test set: accuracies, per-class breakdowns, and the verdict on each model. |
| [training-runbook.md](training-runbook.md) | The runbook for the SLURM training jobs: upload → submit → monitor → bring the artifact back → wire it in. |
| [backend-pregled-SL.md](backend-pregled-SL.md) | Slovenski pregled: vsi modeli, kaj vsak dela, kako so povezani, in logika za neznanega avtorja. |
| [file-naming.md](file-naming.md) | How artist and title are recovered from raw archive filenames. |

## Raw evaluation artifacts

[`evaluation/`](evaluation/) holds the JSON output of the evaluation runs the
numbers in the top-level README are quoted from, plus the two scripts that
produced them:

| File | What it is |
|---|---|
| `f2_hires_eval_full.json` | ViT-L/14 @336 multi-task classifier, full test set |
| `f2_hires_eval.json` | the same model on the 1,500-image sub-sample |
| `f2_baseline_eval.json` | ViT-B/16 @224 baseline, full test set |
| `clip_zeroshot_eval.json` | CLIP ViT-B/32 zero-shot baseline, full test set |
| `f2_artist_openset_calibration.json` | threshold calibration for the open-set "unknown artist" decision |
| `clip_zeroshot_eval.py` | the zero-shot evaluation script |
| `f6_coverage_eval.py` | F6 channel coverage over a collection |

## Screenshots

[`images/`](images/) holds the scene screenshots used by the top-level README.
