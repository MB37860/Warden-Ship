# Backend Architecture

## 2.1 Overview

The backend is a single **Flask** service ([backend/app.py](../backend/app.py))
that registers six blueprints and a background **pipeline runner**. It owns all
machine‑learning inference and all persistence. The frontend never talks to
MongoDB or a model directly — only to these REST endpoints.

```
                       ┌──────────────────────── Flask app ────────────────────────┐
  Frontend (REST)  ──▶ │  /api/image     image upload / list / semantic search       │
                       │  /api/database  create / list / delete named DBs            │
                       │  /api/f2        classify (style/genre/artist), labels, health│
                       │  /api/f5        history-map coords / index / summary         │
                       │  /api/f6        attribute filters: index / coords / filter   │
                       │  /api/pipeline  run / status / cancel background pipelines    │
                       └───────────┬───────────────────────┬───────────────────────┘
                                   │                        │
                      ┌────────────▼─────────┐   ┌──────────▼───────────────┐
                      │ MongoDB + GridFS     │   │ Models / pipelines        │
                      │  image bytes (GridFS)│   │  CLIP (transformers)      │
                      │  image_metadata docs │   │  F2 multi-task ViT (.pt)  │
                      │  CLIP embeddings      │   │  F5 PCA/cluster builder   │
                      │  feature.f2 results  │   │  F6 CV channels (colour,…)│
                      └──────────────────────┘   └──────────────────────────┘
```

Configuration is via environment variables (loaded from `.env`):
`FLASK_HOST`/`FLASK_PORT`, `MONGO_URI`, `MONGO_DB_PREFIX`/`MONGO_DB_NAME`, the
`F2_*` model knobs, and `F6_*`/head‑pose knobs. CORS is open for `/api/*`.

## 2.2 Data layer — MongoDB + GridFS

Storage is **multi‑database**: each named collection the user creates becomes a
physical Mongo database `"{MONGO_DB_PREFIX}_{db_name}"` (default prefix
`warden_ship`). Within each:

- **`images`** — a GridFS bucket holding the raw image bytes, referenced by
  `file_id` (`ObjectId`).
- **`image_metadata`** — one document per image:
  `file_id`, `filename`, `content_type`, `size_bytes`, `tags`, free‑form
  `metadata`, an optional **`embedding`** (CLIP vector, L2‑normalized), a
  `features` object (e.g. `features.f2` populated by the F2 pipeline), and
  `created_at`. Indexes: unique on `file_id`, non‑unique on `filename`.

This separation (binary in GridFS, queryable metadata + vector in a document) is
simple and robust for the dataset sizes used here (10–1000+ images per archive).

## 2.3 The CLIP service

[api/clip_service.py](../backend/api/clip_service.py) is a **lazy singleton**
around `openai/clip-vit-base-patch32` (HuggingFace Transformers):

- `clip_available()` — whether torch/transformers/PIL imported successfully.
- `embed_images(bytes[])` → L2‑normalized float32 image vectors.
- `embed_text(str)` → one L2‑normalized text vector.

Because vectors are normalized, a dot product equals cosine similarity. The
model loads on first use and is cached in a module global. **Everything degrades
gracefully**: if CLIP can't import, uploads still succeed (no embedding) and
search falls back to lexical scoring.

## 2.4 REST API reference

### `/api/image` — storage & semantic search
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | service check |
| POST | `/upload-image` | single image → GridFS + metadata + CLIP embedding |
| POST | `/upload-batch` | many images (`images` field) + `metadata_by_name`; batched embedding |
| GET | `/images` | list metadata (db‑scoped) |
| GET | `/semantic-search?query=&top_k=` | **F1**: embed text, cosine‑rank stored vectors (lexical fallback) |
| GET | `/image/<file_id>` | stream bytes from GridFS |

Semantic search uses a short‑TTL in‑memory embedding cache
(`_embedding_index_cache`, 10 s) and a linear scan over the db's vectors — O(N·d),
fine for these archive sizes.

### `/api/database`
`list`, `create`, `get/<db_name>`, `delete/<db_name>`, `get-active` — manage the
named databases (with image counts used by the cinematic dataset picker).

### `/api/f2` — classifier
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | reports whether a trained model is loaded, its kind, device, label counts, last error |
| GET | `/labels` | the 27 styles / 10 genres / 25 artists label sets |
| POST | `/classify` | run the multi‑task classifier on an image, return top‑k per head |

### `/api/f5` — history map
`health`, `summary`, `index`, `coords` — serve the PCA/cluster/neighbour
artifacts produced by the F5 pipeline (consumed by F3/F4/F5 in the UI).

### `/api/f6` — attribute filters
`health`, `summary`, `index`, `coords`, `filter` (POST) — serve the four
precomputed CV channels plus the WikiArt origin metadata. Output is **scoped per database**
(`f6_attributes/output/<db_name>`) so one archive never reads another's
stale index.

### `/api/pipeline` — background jobs
`run` (POST), `status` (GET), `cancel` (POST). State is persisted in
`.pipeline_state.json` (file‑locked, see `pipeline_state_store.py`) so progress
survives restarts and is pollable by the UI.

## 2.5 The pipeline runner

[api/pipeline_api.py](../backend/api/pipeline_api.py) starts each requested
pipeline on a worker thread and tracks `status`/`progress`/`message`/`can_use`:

- **F1** — handled *inline*: computes & stores CLIP embeddings for the db's
  images (then invalidates the semantic‑search cache). No subprocess.
- **F2** — runs the classifier over images whose filename looks "unnamed"
  (heuristic `_needs_logbook_classification` strips catalog IDs / "unknown"
  tokens) and writes `features.f2` back into each metadata doc.
- **F5** — spawns `python -m backend.f5_history_map.run_pipeline` against the
  db‑scoped output dir.
- **F6** — spawns `python -m backend.f6_attributes.run_pipeline`.

## 2.6 Feature pipelines (offline/compute side)

### F1 index builders — `f1_search/`
`build_f1_clip_index.py` reads images from GridFS, batches CLIP embeddings, and
writes a **FAISS** `IndexFlatIP` + `clip_meta.json` + `clip_embeddings.npy`.
`build_reference_clip_index.py` builds a reference set. *Note:* the live search
endpoint currently scans Mongo vectors directly; the FAISS artifacts are staged
for a future large‑scale upgrade.

### F2 classifier — `f2_classification/`
- `classifier.py` — the runtime. Loads a **self‑contained TorchScript** model
  (`F2_MODEL_PATH`), preprocesses to the trained resolution (`F2_INPUT_SIZE`,
  224 or 336), and returns top‑k style/genre/artist with confidence "bands"
  (`radiant`/`steady`/`misty`/`faint`). Robust fallback chain:
  **exported model → CLIP zero‑shot → seeded random** so the API never hard‑fails.
- `backend/training/f2_classification/` — the full FRIDA‑cluster recipe (see [model-evaluation.md](model-evaluation.md)):
  `prepare_dataset.py` (build package, hold out the local test set),
  `train_f2.py` (fine‑tune a `timm` CLIP‑ViT with a **masked multi‑task loss** +
  3 linear heads, export TorchScript with normalization baked in),
  `evaluate_testset.py` / `evaluate_local.py` (score on the held‑out set),
  `taxonomy.py` (raw→canonical WikiArt label mapping), and the `.sbatch` jobs.

### F5 history map — `f5_history_map/run_pipeline.py`
Builds the art‑history map from the strongest available signal: CLIP embeddings
(stored or runtime) with a **handcrafted‑descriptor fallback**, then PCA
projection + clustering + nearest neighbours + timeline metadata + short
interpretation axes. Emits `coords.json`, `index.json`, `summary.json`.
Missing creation years are filled by a **trained year head** (`year_head.py`,
an MLP over CLIP embeddings trained on 137k WikiArt paintings — artist‑disjoint
test MAE ≈ 31y, `year_source: "model_estimate"`), with the old per‑archive
linear regression as fallback (`"estimated"`).

### F6 attribute filters — `f6_attributes/`
A master `run_pipeline.py` orchestrates four self‑contained channels, each
emitting one JSON, then merges them into a unified `index.json`. Channels:

| Channel | Model / algorithm | Output highlights |
|---------|-------------------|-------------------|
| `pose_clustering.py` | **MediaPipe Pose** (33 kpts) + sklearn | per‑joint visibility, DBSCAN clusters, 2D projection; skeletons under 8 % of the image are dropped |
| `hsl_color.py` | OpenCV/k‑means | dominant HSL palette + hue/saturation/lightness histograms |
| `hough_explorer.py` | OpenCV Canny + Hough | ρ/θ signature per painting; the frontend derives density and direction bands from it |
| `portrait_pose.py` | **RetinaFace** five‑landmark geometry (default; `HEAD_POSE_BACKEND` also accepts `mediapipe` FaceMesh + `solvePnP` or an ONNX DNN) | yaw/pitch/roll per portrait; movement/year from WikiArt path |

Origin is not a channel of its own: `run_pipeline.py` reads
`data/WikiArt_dataset/WikiArt.parquet` and maps the artist's nationality to a
continent while building `index.json`. The emotions (DeepFace) and objects
(YOLOv8) channels were removed on 26 Aug 2026.

`fallback_features.py` provides portable approximations so the pipeline still
produces usable output when a heavy model isn't installed.

## 2.7 Libraries used (backend)

`flask`, `flask-cors`, `flask-limiter`, `pymongo`/`gridfs`, `python-dotenv`;
**`torch`**, **`transformers`** (CLIP), `pillow`, `numpy`; for F6:
`opencv-python(-contrib)`, `scikit-learn`,
**`deepface`** + `tensorflow`/`tf-keras`, **`mediapipe`**, and optional
`faiss`/`umap-learn`/`onnxruntime`. The CV stack is intentionally pinned
(NumPy 1.26 / MediaPipe 0.10.21 / TF 2.16) to avoid the NumPy‑2 break.

## 2.8 Where compute runs

- **Training**: on the FRIDA SLURM cluster (GPU). Artifacts are exported and
  copied back.
- **Serving/inference**: **locally** from those artifacts. The app does not
  depend on a live cluster connection. CLIP and the F2 model run on CPU by
  default (`F2_MODEL_DEVICE=cuda` to use a GPU if present).
