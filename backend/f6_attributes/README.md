# Painting CV Backend — Feature 6: Interactive Visual Attribute Filters

Pre-computation scripts for the four CV filter channels. Each script is
self-contained and can be run independently or via the master runner. The fifth
control in the scene, the origin globe, has no script of its own: `run_pipeline.py`
maps the artist's nationality from `data/WikiArt_dataset/WikiArt.parquet` to a
continent while building `index.json`.

The emotions (DeepFace) and objects (YOLOv8) channels were removed on 26 Aug 2026.

---

## Directory layout

```
f6_attributes/
├── run_pipeline.py       ← master runner (runs all steps + the unified index)
├── utils.py              ← shared I/O helpers
├── fallback_features.py  ← filename-based stand-ins when a detector is missing
├── mediapipe_compat.py   ← version-tolerant MediaPipe import
├── pose_clustering.py    ← body pose clustering (MediaPipe + sklearn)
├── hsl_color.py          ← HSL color navigation
├── hough_explorer.py     ← Hough transform pre-computation
├── portrait_pose.py      ← yaw/pitch/roll per portrait (RetinaFace by default)
└── requirements.txt
```

---

## Quick start

```bash
pip install -r requirements.txt

# Run everything
python run_pipeline.py /data/paintings /data/output

# Run a single step
python pose_clustering.py /data/paintings /data/output/poses.json
python hsl_color.py       /data/paintings /data/output/colors.json
python hough_explorer.py  /data/paintings /data/output/hough.json
python portrait_pose.py   /data/paintings /data/output/portrait_poses.json

# Run only selected steps
python run_pipeline.py /data/paintings /data/output --steps colors hough
```

All scripts support `--no-resume` to reprocess from scratch.

---

## Output files

| File                  | Used by                    | Key fields                              |
|-----------------------|----------------------------|-----------------------------------------|
| `poses.json`          | Lay figure (3 arm poses)   | `keypoints`, `pose_ratio`, `valid`, `cluster` |
| `colors.json`         | Dye swatch board           | `palette_hsl`, `palette_weights`, `hist_h/s/l` |
| `hough.json`          | Line board                 | `presets.{fine,medium,coarse}`         |
| `portrait_poses.json` | Carved head (5 sectors)    | `yaw`, `pitch`, `roll`, `movement`     |
| `index.json`          | Unified per-painting index | `features.{pose,color,hough,portrait_pose,meta}` |

`index.json` is rebuilt automatically by `api/f6_api.py` when any feature file is
newer than it, so a re-run of a single channel cannot leave the interface serving
data that is no longer on disk.

---

## Backend integration

The pipeline's job ends at the JSON files. Serving them is `backend/api/f6_api.py`,
which reads `index.json` and hands the merged records to the frontend; the filtering
itself runs in the browser (`src/lib/f6Filters.ts`), against the loaded collection.

The serve-time query helpers each module used to carry (hue slices, histogram
matching, cluster summaries, box-whisker aggregates) were removed once the
interface stopped calling them — nothing on either side used them.

---

## Environment variables

| Variable              | Default       | Description                                   |
|-----------------------|---------------|-----------------------------------------------|
| `HEAD_POSE_BACKEND`   | `retinaface`  | `retinaface`, `mediapipe` or `dnn`            |
| `HEAD_POSE_MODEL_PATH`| *(empty)*     | Path to ONNX model when `HEAD_POSE_BACKEND=dnn`|

RetinaFace is the default because FaceMesh is trained on photographs: on 46
figurative test paintings it found 14 faces (30 %) with geometrically impossible
angles, against RetinaFace's 35 (76 %) within a plausible range.

Train or fine-tune expensive models on the cluster, then copy the exported
artifacts to the app host. The runtime reads local files only; it does not
depend on a persistent cluster connection.

---

## Image directory convention (optional)

If your images follow the WikiArt layout:

```
<root>/<movement>/<artist>/<YYYY>_<title>.jpg
```

`portrait_pose.py` will automatically populate the `movement` and `year` fields.

Otherwise, supply an external metadata JSON via a post-processing step:

```python
import json
records = json.load(open("portrait_poses.json"))
meta    = json.load(open("your_metadata.json"))  # {id: {movement, year}}
for r in records:
    r.update(meta.get(r["id"], {}))
json.dump(records, open("portrait_poses.json", "w"))
```
