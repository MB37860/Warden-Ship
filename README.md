<div align="center">

# ⚓ Warden Ship

### An interactive 3D explorer for digitised art collections

*A keeper, not a generator.* The ship is a **warden** of human-made artworks —
every model on board points **inward**, at helping a person find, date,
classify and connect paintings that already exist.

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![React Three Fiber](https://img.shields.io/badge/React_Three_Fiber-9-000000?logo=three.js&logoColor=white)](https://r3f.docs.pmnd.rs)
[![Flask](https://img.shields.io/badge/Flask-3-000000?logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![MongoDB](https://img.shields.io/badge/MongoDB-GridFS-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com)
[![PyTorch](https://img.shields.io/badge/PyTorch-CLIP_+_ViT-EE4C2C?logo=pytorch&logoColor=white)](https://pytorch.org)
[![Electron](https://img.shields.io/badge/Electron-desktop-47848F?logo=electron&logoColor=white)](https://www.electronjs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<img src="docs/images/deck.jpg" alt="The deck of The Warden at night" width="100%">

</div>

---

## What this is

You drop a ZIP of paintings onto the deck of a ship called **The Warden**. The
archive is stored, embedded and analysed by six machine-learning and
computer-vision pipelines — and then handed back to you as six *places you can
walk into*, not six dashboards.

Type *"a stormy sea at night"* and the collection re-forms as a constellation.
Open the logbook and an unnamed canvas gets a style, a genre and an artist.
Spread the chart table and five centuries of painting lay themselves out by
visual kinship. Every result is precomputed, local, and reachable from a
cinematic voyage that never blocks while the pipelines run.

This is the software half of a bachelor's thesis at the University of Ljubljana,
Faculty of Computer and Information Science. The full write-up (in Slovene) is
in **[docs/thesis.pdf](docs/thesis.pdf)**.

---

## The six instruments

<table>
<tr>
<td width="50%" valign="top">

### 🔭 F1 · Star Atlas
**Semantic search.** A natural-language query embeds through CLIP; the
collection re-forms as a constellation where the most relevant works are
brightest, largest and most central. Falls back to a local lexical ranking if
the backend is down, so the scene never dies.

<img src="docs/images/star-atlas.jpg" alt="Star Atlas semantic search" width="100%">

</td>
<td width="50%" valign="top">

### 📖 F2 · Logbook
**Style / genre / artist classification.** Every canvas that arrives without a
proper name gets a page: 27 styles, 10 genres, top-25 artists, each with a
confidence band and art-historical "echoes" of the near-miss classes.

<img src="docs/images/logbook.jpg" alt="Logbook classification gallery" width="100%">

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🌊 F3 · Creativity Currents
**Originality over time.** Each work gets a creativity reading decomposed into
colour, composition and subject, plotted along the archive's chronology —
derived client-side from the F5 map.

<img src="docs/images/creativity.jpg" alt="Creativity currents chart" width="100%">

</td>
<td width="50%" valign="top">

### 🧭 F4 · Influence Routes
**Directed visual lineage.** Time-directed links between visually similar works
(older → newer), with the supporting artwork pairs shown side by side.

<img src="docs/images/influence.jpg" alt="Influence routes chart" width="100%">

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🗺️ F5 · Chart Table
**The map of art history.** CLIP embeddings → PCA → clustering → nearest-
neighbour linking. Undated works are dated by a trained year head before they
take their place on the timeline.

<img src="docs/images/chart-table.jpg" alt="Chart table history map" width="100%">

</td>
<td width="50%" valign="top">

### 🕯️ F6 · Captain's Quarters
**Four classical-CV filters.** A lay figure (MediaPipe pose), a dye board
(k-means HSL), a line board (Canny + Hough) and a carved head (RetinaFace
landmarks) — plus a globe for origin. Filters compose; nothing infers at view
time.

<img src="docs/images/captains-quarters.jpg" alt="Captain's quarters attribute filters" width="100%">

</td>
</tr>
</table>

<details>
<summary><b>The rest of the voyage</b> — deck, chest room, hallway, island</summary>
<br>

| | |
|---|---|
| <img src="docs/images/chest-room.jpg" alt="Chest room" width="100%"><br>**Chest room** — drop a ZIP archive into the chest to load a collection. | <img src="docs/images/hallway.jpg" alt="Hallway" width="100%"><br>**Hallway** — the hub the six instruments hang off. |
| <img src="docs/images/island.jpg" alt="Island telescope" width="100%"><br>**Island** — the telescope that opens the Star Atlas. | <img src="docs/images/deck.jpg" alt="Deck" width="100%"><br>**Deck** — the sea of images the voyage starts on. |

</details>

---

## Measured results

Every model was evaluated on the same **12,680-image held-out test set**
(artist-disjoint splits, seed 42). Raw artifacts are in
[`docs/evaluation/`](docs/evaluation/); the analysis is in
[`docs/model-evaluation.md`](docs/model-evaluation.md).

### Style / genre / artist classification (F2)

| Model | Style (27 cls) | Genre (10 cls) | Artist (top-25) |
|---|---:|---:|---:|
| CLIP ViT-B/32, zero-shot *(baseline)* | 25.8 % | 57.7 % | 56.0 % |
| Fine-tuned multi-task ViT-B/16 @224 | 68.1 % | 83.7 % | 94.5 % |
| **Fine-tuned multi-task ViT-L/14 @336** | **77.0 %** | **86.3 %** | **97.3 %** |

### Adapting the retrieval stack to the art domain

| Task | Before | After | Method |
|---|---:|---:|---|
| Zero-shot style accuracy | 25.8 % | **55.3 %** | contrastive CLIP fine-tuning |
| Zero-shot genre accuracy | 57.7 % | **79.8 %** | contrastive CLIP fine-tuning |
| Style retrieval, precision@1 | 41.6 % | **61.0 %** | ArcFace metric embedding |

### Dating an undated painting (F5 year head)

| Metric | Value |
|---|---:|
| Mean absolute error (test, n = 12,239) | **31.2 years** |
| Naive baseline (predict the median year) | 73.5 years |
| Median absolute error | 18.8 years |
| Within 50 years | 85.1 % |

---

## Architecture

```mermaid
flowchart LR
    subgraph FE["🖥️ frontend/ — React 19 + React Three Fiber"]
        direction TB
        SC["Scenes<br/>deck · chest room · hallway<br/>island · quarters"]
        FT["Features<br/>F1 … F6"]
        API["src/api/*.js<br/>the only place fetch lives"]
        SC --> FT --> API
    end

    subgraph BE["⚙️ backend/ — Flask"]
        direction TB
        BP["Blueprints<br/>/api/image · /api/f2<br/>/api/f5 · /api/f6 · /api/pipeline"]
        RUN["Pipeline runner<br/>background subprocesses"]
        CLIP["CLIP service<br/>text + image embeddings"]
        BP --> RUN
        BP --> CLIP
    end

    subgraph ML["🧠 Models & pipelines"]
        direction TB
        M1["F1 · CLIP ViT-B/32<br/>semantic vectors"]
        M2["F2 · multi-task ViT<br/>TorchScript export"]
        M5["F5 · PCA + clustering<br/>+ year head"]
        M6["F6 · MediaPipe · RetinaFace<br/>OpenCV k-means · Hough"]
    end

    DB[("MongoDB + GridFS<br/>images · metadata · vectors")]

    API -- "HTTP/JSON" --> BP
    RUN --> M1 & M2 & M5 & M6
    CLIP --> M1
    BP <--> DB
    M1 & M2 & M5 & M6 <--> DB
    M5 -- "coords.json" --> FT
    M6 -- "index.json" --> FT
```

Two rules hold the design together:

1. **Nothing infers at view time.** F1, F2, F5 and F6 run as background
   pipelines through `/api/pipeline/run`; the UI stays interactive throughout
   and reads only precomputed JSON.
2. **Output is scoped per collection.** F5 and F6 artifacts live under
   `output/<database>/`, so one upload can never read another's stale index.

<details>
<summary><b>REST API</b> — every endpoint the frontend talks to</summary>

<br>

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | identify the process (the desktop shell uses it to avoid double-spawning) |
| `POST` | `/api/image/upload-batch` | upload an archive into a named collection |
| `GET` | `/api/image/images` | list stored artworks |
| `GET` | `/api/image/image/<file_id>` | stream one image out of GridFS |
| `GET` | `/api/image/semantic-search` | **F1** — CLIP text-to-image search |
| `POST` | `/api/f2/classify` | **F2** — style / genre / artist for one image |
| `GET` | `/api/f2/labels` | the label taxonomy the classifier was trained on |
| `GET` | `/api/f5/coords` | **F5** — history-map coordinates for a collection |
| `GET` | `/api/f5/index`, `/api/f5/summary` | the map's manifest and cluster summary |
| `GET` | `/api/f6/index` | **F6** — merged attribute index (pose, colour, hough, portrait) |
| `GET` | `/api/f6/coords`, `/api/f6/summary` | attribute coordinates and channel coverage |
| `POST` | `/api/pipeline/run` | start F1 / F2 / F5 / F6 in the background |
| `GET` | `/api/pipeline/status` | poll pipeline progress |
| `POST` | `/api/pipeline/cancel` | cancel a running pipeline |
| `GET` | `/api/database/list`, `/create`, `/delete/<name>` | manage collections |

Every feature endpoint takes `?db_name=<collection>`; output is scoped per
collection on disk.

</details>

---

## Quick start

**Prerequisites** — Python 3.10+, Node.js 18+, and a MongoDB you can reach.

```bash
git clone https://github.com/MB37860/Warden-Ship.git
cd Warden-Ship
cp .env.example .env          # defaults work out of the box
```

<table>
<tr><th>1 · Database</th><th>2 · Backend</th><th>3 · Frontend</th></tr>
<tr valign="top">
<td>

```bash
docker run -d -p 27017:27017 \
  --name mongodb mongo:latest
```

</td>
<td>

```bash
python -m venv .venv
.venv/bin/pip install \
  -r backend/requirements.txt
.venv/bin/python backend/app.py
```

</td>
<td>

```bash
cd frontend
npm ci
npm run dev
```

</td>
</tr>
</table>

Open the URL Vite prints (usually `http://localhost:5173`), drop a ZIP of
images into the chest, pick which pipelines to run, and start walking.

> [!NOTE]
> First run downloads CLIP weights from Hugging Face (~600 MB). Everything
> after that is local.

**Checks:**

```bash
cd frontend && npm run test:run && npm run lint   # 50 tests, eslint clean
cd frontend && npm run build                      # production bundle
```

---

## Repository layout

```
Warden-Ship/
├── backend/                     Flask API + ML pipelines
│   ├── app.py                   dev entry point  ·  electron_server.py for the desktop shell
│   ├── api/                     blueprints: image, database, f2, f6, pipeline · clip_service
│   ├── f1_search/               CLIP index builders
│   ├── f2_classification/       runtime classifier (TorchScript → CLIP zero-shot → fallback)
│   ├── f5_history_map/          history-map pipeline, year head, /api/f5
│   ├── f6_attributes/           the four CV channels + the unified index
│   └── training/                offline / SLURM jobs, one directory per model
├── frontend/                    Vite + React 19 + React Three Fiber, Electron shell
│   ├── src/components/scenes/   the 3D environments
│   ├── src/components/features/ f1 … f6
│   ├── src/api/                 every HTTP call in the app
│   └── electron/                desktop main + preload
├── data/f5_year_head/           the one committed model artifact (1.2 MB)
└── docs/                        thesis PDF, architecture, features, evaluation
```

---

## Desktop build

The app also ships as a self-contained Electron desktop build with a portable
Python runtime and a bundled MongoDB — no system Python, no system database.

```bash
cd frontend
npm run electron:dev      # dev: Vite + Electron together
npm run electron:build    # package an AppImage / dmg / zip into frontend/release/
```

CI does the same on Linux, macOS and Windows —
see [`.github/workflows/build-desktop.yml`](.github/workflows/build-desktop.yml).
Native ML wheels can't be cross-compiled, so each OS builds on its own runner.

---

## Training the models

Training is offline and cluster-bound; the app only ever reads exported
artifacts. Each job lives in its own directory under `backend/training/` with
its own README and SLURM script:

| Directory | Produces |
|---|---|
| `training/f2_classification/` | the multi-task style/genre/artist ViT (the headline model) |
| `training/f1_clip_finetune/` | art-domain contrastive CLIP |
| `training/f1_embedding/` | the ArcFace style-retrieval embedding |
| `training/f5_year_head/` | the year regressor over CLIP vectors |

Full runbook: [`docs/training-runbook.md`](docs/training-runbook.md).

---

## Documentation

| Document | What it covers |
|---|---|
| [docs/thesis.pdf](docs/thesis.pdf) | the complete thesis (Slovene, with English abstract) |
| [docs/concept-and-frontend.md](docs/concept-and-frontend.md) | the idea, the voyage, every scene and element |
| [docs/backend-architecture.md](docs/backend-architecture.md) | Flask service, data layer, pipeline runner, all endpoints |
| [docs/features.md](docs/features.md) | F1–F6 element by element, with the model behind each |
| [docs/model-evaluation.md](docs/model-evaluation.md) | how the numbers above were measured, per-class breakdowns |
| [docs/training-runbook.md](docs/training-runbook.md) | upload → submit → monitor → export → wire in |
| [docs/backend-pregled-SL.md](docs/backend-pregled-SL.md) | slovenski pregled zaledja in modelov |
| [docs/file-naming.md](docs/file-naming.md) | how artist and title are recovered from a filename |

---

## A note on how this was built

Large parts of this codebase were written **with the help of AI coding
assistants** (Claude), used as a pair programmer throughout: scaffolding
components, drafting pipelines, refactoring, and writing tests. Every
architectural decision, every model choice, all training and evaluation runs,
and the review of what actually landed are the author's own — as is the
responsibility for the result.

The numbers reported above come from real evaluation runs on a held-out test
set, not from a model's estimate; the raw artifacts are committed in
[`docs/evaluation/`](docs/evaluation/) so anyone can check them.

---

## Credits

- **Dataset** — [WikiArt](https://www.wikiart.org/), via the WikiArt parquet distribution, for training and evaluation.
- **AGIQA-3K** — the AI-generated images drifting on the sea in the deck scene come from the AGIQA-3K dataset; they are the one place in the app where machine-made imagery appears, deliberately, as the thing the ship is a warden *against*.
- **Models** — OpenAI CLIP, Google MediaPipe, RetinaFace, OpenCV, PyTorch, Hugging Face Transformers.
- **3D assets** — the `.glb` models in `frontend/src/assets/models/` are third-party assets used under their respective terms.

**Author** — Matej Breskvar
**Supervisors** — prof. dr. Narvika Bovcon, doc. dr. Blaž Meden
University of Ljubljana, Faculty of Computer and Information Science, 2025/26

Source code is MIT licensed — see [LICENSE](LICENSE) for the third-party asset carve-outs.
