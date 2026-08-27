# Feature Catalogue (F1–F6)

Each feature is a research idea from the source articles ([A1]–[A11], listed at the end of this document) turned into
an interactive scene. The arrow always points *into* the human archive: every
feature is an instrument for **looking at existing paintings**, never for
generating new ones.

---

## F1 · Star Atlas — Semantic Visual Search

- **Scene:** Star Atlas (`features/f1/StarView.jsx`), reached through the island
  telescope.
- **What it does:** You type a natural‑language query ("a stormy sea at night")
  and the collection re‑forms as a **constellation** of stars — one per painting
  — where the most relevant artworks are brightest, largest and most central.
- **Model:** OpenAI **CLIP** (`clip-vit-base-patch32`). The query text is
  embedded; each painting's stored image embedding is scored by cosine
  similarity (`/api/image/semantic-search`).
- **Elements:** themed star palettes (`STAR_THEMES`), SVG constellation
  templates fit to the result set (`utils/constellationFitter.js`), proximity
  links between similar works, hover previews, fullscreen modal, and a cinematic
  auto‑search mode. **Graceful offline mode**: if the backend is down it ranks
  with a local lexical heuristic so the scene still demonstrates.
- **Upgrade over the source articles:** turns the batch CNN‑retrieval of
  Seguin et al. [A10] / Saleh & Elgammal [A3] into a real‑time, cross‑modal,
  text‑driven experience.

---

## F2 · Logbook Gallery — Style / Genre / Artist Classifier

- **Scene:** Logbook Gallery (`features/f2/LogbookGallery.jsx`) — a ship's
  logbook whose pages are filled in for artworks that arrived **without a
  proper name**.
- **What it does:** For each unnamed upload it predicts **style** (27 classes),
  **genre** (10), and **artist** (top‑25) with confidence scores, rendered as
  illuminated logbook entries with confidence "bands"
  (`radiant`/`steady`/`misty`/`faint`) and art‑historical "echoes" (related
  styles, e.g. *Cubism → Analytical/Synthetic Cubism*).
- **Model:** a **fine‑tuned multi‑task Vision Transformer** exported as
  self‑contained TorchScript (the headline trainable model — see
  [model-evaluation.md](model-evaluation.md)). Two trained
  variants exist: a **ViT‑B/16 CLIP @224** baseline and a **ViT‑L/14 CLIP @336**
  high‑res model. Runtime: `f2_classification/classifier.py` via `/api/f2/classify`.
- **Robustness:** exported model → CLIP zero‑shot → seeded‑random fallback, so a
  classification always returns.
- **Upgrade over the articles:** replaces the old frozen‑CLIP‑linear‑head plan
  with a fully fine‑tuned, masked multi‑task network ([A3], [A5], [A11]); shows
  confusion structure as a *feature* (style echoes) rather than just accuracy.

---

## F3 · Creativity Currents — Originality over Time

- **Scene:** Creativity Currents (`features/f3/CreativityCurrents.jsx`), a cabin
  sea‑chart sharing the F5 history‑wall scene.
- **What it does:** Plots each artwork on a time axis with a **creativity
  reading** decomposed into dimensions — *overall / color / composition /
  subject* (`CREATIVITY_DIMENSIONS`) — so you can see originality peaks across
  the archive's chronology.
- **How it works:** **derived client‑side** in
  [utils/historicalAnalysis.js](../frontend/src/utils/historicalAnalysis.js)
  from the F5 map's `(x, y, year)` coordinates — a lightweight, interactive
  realization of the creativity‑network idea in Elgammal & Saleh [A4]
  (full PageRank‑style influence network is not computed at runtime).

---

## F4 · Influence Routes — Directed Visual Links

- **Scene:** Influence Routes (`features/f4/InfluenceRoutes.jsx`), the other mode
  of the shared history‑wall scene.
- **What it does:** Draws **time‑directed links** between visually similar works
  (older → newer), with supporting artwork pairs, so you can trace plausible
  visual lineage through the collection.
- **How it works:** also derived from the F5 coordinates + years in
  `historicalAnalysis.js` (bridge scores, neighbour links) — the interactive
  take on Saleh, Abe & Elgammal's influence graphs [A2].

---

## F5 · Chart Table — Art‑History / Style‑Evolution Map

- **Scene:** Chart Table (`features/f5/HistoryTable.jsx`) — the navigator's map,
  the data source for F3 and F4.
- **What it does:** Positions paintings in a 2D map by visual characteristics,
  colours them by cluster, exposes neighbours and timeline metadata, and lets
  you open the Creativity (F3) or Influence (F4) overlays.
- **How it works:** the **F5 pipeline** (`f5_history_map/run_pipeline.py`)
  embeds the archive with **CLIP** (stored or runtime, handcrafted‑descriptor
  fallback), runs **PCA** projection + clustering + nearest‑neighbour linking,
  and writes `coords/index/summary` JSON served at `/api/f5/coords`. This is the
  navigable realization of Elgammal et al.'s "shape of art history" [A5] framed
  with Manovich's cultural‑analytics lens [A8].

---

## F6 · Captain's Quarters — Interactive Visual Attribute Filters

- **Scene:** Captain's Quarters (`features/f6/CaptainsQuarters.tsx`) — a "1640
  archive" room where four classical‑CV instruments plus a globe filter the
  collection. Active
  filters compose (`filterPaintings`, `countActive`), all backed by precomputed
  artifacts (no live inference at view time).
- **The four channels** (precomputed by `f6_attributes/run_pipeline.py`,
  served via `/api/f6/*`):

  | Filter | Object in the room | Model / algorithm | Interaction |
  |--------|--------------------|-------------------|-------------|
  | **Poses** | lay figure | MediaPipe Pose (33 kpts), visibility‑gated | pick one of three arm poses (raised / out / lowered) |
  | **Colors** | dye swatch board | OpenCV/k‑means HSL | pin one or more of six colour families (ANDed); saturation and lightness sliders, each band a third of the collection |
  | **Hough** | line board | OpenCV Canny + Hough | intensity slider + direction bands, each the third of the collection most committed to it |
  | **Portrait pose** | carved head | RetinaFace, five facial landmarks | pick one of five compass sectors from the sitter's head yaw |

  A fifth control, the **globe**, filters by origin: `run_pipeline.py` maps the
  artist's nationality from `WikiArt.parquet` to a continent (`NATION_TO_REGION`).
  The emotions (DeepFace) and objects (YOLOv8) channels were removed on
  26 Aug 2026.

- **Upgrade over the articles:** unifies the six prototype modes of Jenič et al.
  [A6] into one coherent, database‑scoped UI, adds the
  portrait‑pose analysis from Stork [A1], and precomputes everything for instant
  interaction.

---

## Feature → model → endpoint summary

| Feature | Primary model/algorithm | Compute | Endpoint |
|---------|------------------------|---------|----------|
| F1 Star Atlas | CLIP ViT‑B/32 (text+image) | inline embeddings + cosine scan | `/api/image/semantic-search` |
| F2 Logbook | fine‑tuned multi‑task ViT (B/224 or L/336) | local TorchScript inference | `/api/f2/classify` |
| F3 Creativity | derived from F5 coords | client‑side | (uses F5 data) |
| F4 Influence | derived from F5 coords | client‑side | (uses F5 data) |
| F5 Chart Table | CLIP + PCA + clustering | offline pipeline | `/api/f5/coords` |
| F6 Filters | MediaPipe · RetinaFace · OpenCV | offline pipeline | `/api/f6/*` |

---

## Source articles

The `[A1]`–`[A11]` codes above refer to the papers the features were derived
from:

| Code | Paper |
|---|---|
| A1 | Stork — *Computer Vision, ML, and AI in the Study of Fine Art Paintings and Drawings* (2024) |
| A2 | Saleh, Abe & Elgammal — *Knowledge Discovery of Artistic Influences: A Metric Learning Approach* |
| A3 | Saleh & Elgammal — *Large-scale Classification of Fine-Art Paintings: Learning the Right Metric on the Right Feature* |
| A4 | Elgammal & Saleh — *Quantifying Creativity in Art Networks* |
| A5 | Elgammal et al. — *The Shape of Art History in the Eyes of the Machine* |
| A6 | Jenič, Omahen, Udovč, Uhan, Meden, Bovcon — *Sistem za interaktivno pregledovanje slikarske zbirke* (2025) |
| A7 | Radford et al. — *Learning Transferable Visual Models From Natural Language Supervision* (CLIP, 2021) |
| A8 | Manovich — *Data Science and Digital Art History* (IJDAH, 2015) |
| A9 | Oquab et al. — *DINOv2: Learning Robust Visual Features without Supervision* (TMLR, 2024) |
| A10 | Seguin, Striolo, di Lenardo & Kaplan — *Visual Link Retrieval in a Database of Paintings* (ECCV Workshops, 2016) |
| A11 | Castellano & Vessio — *Deep learning approaches to pattern extraction and recognition in paintings and drawings* (NCAA, 2021) |
