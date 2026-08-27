# Concept & Frontend

## 1.1 The idea

The application is best understood as a **Google‑style experiment**: a small,
opinionated, beautifully‑staged interactive piece that takes one serious idea
from computational art history and makes it *playable*. The serious idea is:

> A painting collection is a space. Modern vision models (CLIP, fine‑tuned
> transformers, classical CV) turn each artwork into coordinates in that space.
> Once everything is a coordinate, you can **search**, **classify**,
> **compare**, and **wander** through art the way you'd wander through a map of
> stars.

The crucial framing — and the thing that separates this from the flood of
"AI art generators" — is the **direction of the arrow**:

- This is **not** a generative tool. It does not invent, complete, or
  hallucinate new images.
- It is a **vault and a telescope**. The ship, *the Warden*, is the **keeper of
  human‑made artworks**. The AI is pointed *inward at the existing collection*
  to help a human explore what humans already made.

That posture is deliberate and is reinforced everywhere in the UX: you *bring*
an archive aboard (ZIP upload), the ship *holds* it, and every feature is a
different *instrument for looking* at it. The contrast is even baked into the
asset library — a folder of AI‑generated images (`src/assets/AGIQA-3K/`) exists
as foil/test material, underscoring that the app's own subject is the genuine,
human archive, not synthetic output.

### The cinematic spine

Per the conference article (`clanek/star_atlas.tex`), the app is structured as a
single cinematic journey toward semantic search:

```
Ship Deck  →  Hallway  →  Chest Room  →  (cannon shot across the sea)
   home        door hub     load archive        transition
                                   ↓
                          Island Telescope  →  Star Atlas
                              moonlit lookout     CLIP semantic search
```

A built‑in **Cinematic Tour** (press `C`, `Esc`/`C` to stop) auto‑pilots that
whole sequence — deck orbit → archive load → broadside turn → cannon flight →
island dolly → star atlas — with on‑screen titles, so the project can present
itself unattended like a real Google experiment landing page. See
`SHOWCASE_*` in [frontend/src/App.jsx](../frontend/src/App.jsx).

## 1.2 The scenes and every navigable element

Navigation is a state machine in
[App.jsx](../frontend/src/App.jsx) (`SCENES`, `SCENE_ITEMS`). A persistent
`SceneNavigator` lets you jump anywhere; a `FeatureProgressStrip` shows live
pipeline progress; deep links work via `?scene=…` (`getInitialScene`).

| Scene (id) | Component | Role / elements |
|------------|-----------|-----------------|
| **Ship Deck** (`ship-exterior`) | `scenes/ShipExterior.jsx` | The home screen. A 3D galleon (`pirate_ship (1).glb`) on an animated painted ocean; the count of loaded artworks is shown. Entering a window → Hallway. Supports a `cinematicMode` orbit. |
| **Hallway** (`hallway`) | `scenes/Hallway.jsx` | The **door hub**. Each door opens one feature: Chest Room (load), F2 Logbook, F3 Creativity, F4 Influence, F5 Chart Table, F6 Captain's Quarters. |
| **Chest Room** (`chest-room`) | `scenes/Room.jsx` | **Dataset selection + upload.** A treasure chest (`old_pirate_table.glb`, cannon props) where you pick/create a database and drag‑drop a WikiArt test ZIP. Drives `upload-batch` and starts the F1/F2/F5/F6 pipelines. |
| **Cannon Flight** (`cannon-shot`) | rendered via `ShipExterior` `isFiringCannons` | Pure **transition**: a broadside fires and the camera rides the cannonball across the sea (fade‑to‑black hand‑off in `handleCannonSequenceComplete`). |
| **Island Telescope** (`island-telescope`) | `scenes/IslandTelescope.jsx` | A moonlit island (`fantasy_island.glb`, `stylized_telescope.glb`). Looking through the telescope → Star Atlas. |
| **Star Atlas** (`star-view`) | `features/f1/StarView.jsx` | **The main retrieval view** (Feature 1). |
| **Logbook Gallery** (`logbook-gallery`) | `features/f2/LogbookGallery.jsx` | Feature 2 — the classifier logbook. |
| **Creativity Currents** (`creativity-currents`) | `features/f3/CreativityCurrents.jsx` | Feature 3 — originality/influence over time. |
| **Influence Routes** (`influence-routes`) | `features/f4/InfluenceRoutes.jsx` | Feature 4 — directed visual links. |
| **Chart Table** (`f5-history-map`) | `features/f5/HistoryTable.jsx` | Feature 5 — the navigator's art‑history map. |
| **Captain's Quarters** (`captains-quarters`) | `features/f6/CaptainsQuarters.tsx` | Feature 6 — four visual‑attribute filters plus the origin globe ("1640 archive"). |

(The per‑feature behaviour is detailed in
[features.md](features.md).)

### Cross‑cutting UI elements

- **Database selector** (`shared/DatabaseSelector.jsx`) — every scene is scoped
  to a named MongoDB database; selection persists in `localStorage`
  (`warden-ship:selected-database`).
- **Pipeline selector + progress strip** (`shared/PipelineSelector.jsx`,
  `FeatureProgressStrip`) — choose which of F1/F2/F5/F6 to run after upload and
  watch non‑blocking progress (`/api/pipeline/status` polled every 1.5 s).
- **Fullscreen image viewer**, **hover menu**, **night sky**, **loading
  progress**, **status text** — shared chrome in `components/shared/`.
- **Scene transitions** — `framer-motion` blur/scale cross‑fades; a fade‑to‑black
  layer for the cannon hand‑off.

## 1.3 Software & models on the frontend

### Framework & rendering stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| UI framework | **React 18** | Functional components + hooks; lazy‑loaded scenes (`React.lazy`/`Suspense`). |
| Build/dev | **Vite** | HMR dev server, `npm run build` for production `dist/`. |
| 3D scenes | **Three.js** via **React Three Fiber** + **@react-three/drei** | Ship/island/telescope/room are `.glb` models in `src/models_3d/`; canvas textures, parallax, drag‑on‑surface, pointer cursors implemented as hooks in `src/hooks/`. |
| Animation | **framer-motion** | Scene cross‑fades, overlays, cinematic timings. |
| Desktop shell | **Electron** | `electron/main.cjs` wraps the built frontend and manages a child Flask backend + a bundled MongoDB; a portable CPython runtime is built by `scripts/build-python-runtime.mjs` so end users need no Python/Mongo install. |
| Tests | **Vitest** + Testing Library | `src/test/` covers navigation, StarView, logbook, creativity, influence, historical analysis, etc. |
| Language | JavaScript (JSX) + some **TypeScript** | F6 (`CaptainsQuarters.tsx`) and the F6 lib/hooks are typed. |

### Where "models" live relative to the frontend

The frontend itself runs **no ML model in the browser**. It is a thin, rich
client that calls the backend over REST (`src/api/*.js`): `imageApi`,
`databaseApi`, `pipelineApi`, `f2Api`, `f5Api`, `f6Api`. All inference happens
on the backend (CLIP, the F2 transformer, MediaPipe/RetinaFace/OpenCV for F6).

What the frontend *does* with model output:

- **F1 / Star Atlas** — sends a text query to `/api/image/semantic-search`,
  receives CLIP‑ranked results, and maps each similarity score to a star's
  radius/size in a constellation. If the backend is unreachable it falls back to
  a local lexical heuristic so the scene still works.
- **F2 / Logbook** — sends unnamed uploads to `/api/f2/classify` and renders the
  returned style/genre/artist predictions (with confidence "bands") as logbook
  pages.
- **F3 / F4** — derived **client‑side** from the F5 history‑map coordinates: the
  creativity score and directed influence links are computed in
  [src/utils/historicalAnalysis.js](../frontend/src/utils/historicalAnalysis.js)
  from `(x, y, year)` coordinates returned by the F5 pipeline.
- **F5 / Chart Table** — reads the PCA/cluster/neighbour artifacts from
  `/api/f5/coords`.
- **F6 / Captain's Quarters** — reads the precomputed attribute JSON via
  `/api/f6/summary`, `/index`, `/coords`, `/filter`.

> Design rule (stated in the frontend README): heavy compute is precomputed
> offline; the UI only ever consumes ready artifacts and stays interactive
> while pipelines run in the background.
