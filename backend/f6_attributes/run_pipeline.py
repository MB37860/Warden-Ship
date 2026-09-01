"""
Master Pipeline Runner
======================
Runs all four CV analysis pipelines in sequence and produces a unified index.

Usage:
    python run_pipeline.py <image_root> <output_dir> [options]

Output files in <output_dir>:
    poses.json          — pose clustering data
    colors.json         — HSL color navigation data
    hough.json          — Hough transform data
    portrait_poses.json — portrait pose analysis data (yaw/pitch/roll)
    index.json          — unified per-painting index (all features merged)

Each sub-script can also be run independently:
    python hsl_color.py <image_root> <output_dir>/colors.json
    ... etc.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

# retina-face 0.0.17 builds its detector with Keras 2 idioms. TensorFlow 2.16+
# ships Keras 3 by default, which rejects them outright - "A KerasTensor cannot
# be used as input to a TensorFlow function" - so every face detection raises
# and the carved head ends up with no painting to turn to. Routing tf.keras back
# to the installed tf-keras 2.16 fixes it.
#
# This has to happen before ANYTHING imports TensorFlow. MediaPipe does, and the
# body-pose step runs before the portrait step, so setting it inside
# portrait_pose.py would already be too late.
os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")

try:
    from backend.pipeline_state_store import write_pipeline_state
except ModuleNotFoundError:  # Keep direct script usage working.
    write_pipeline_state = None

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pipeline steps (each is optional — skipped if the module raises ImportError)
# ---------------------------------------------------------------------------

STEPS = [
    ("poses",           "pose_clustering", "poses.json"),
    ("colors",          "hsl_color",       "colors.json"),
    ("hough",           "hough_explorer",  "hough.json"),
    ("portrait_poses",  "portrait_pose",   "portrait_poses.json"),
]


def _write_state(
    state_file: Path | None,
    pipeline_name: str,
    *,
    progress: float,
    stage: str,
    message: str,
    status: str = "running",
    can_use: bool = False,
    error: str | None = None,
) -> None:
    if state_file is None or write_pipeline_state is None:
        return

    try:
        write_pipeline_state(
            state_file,
            pipeline_name,
            status=status,
            progress=progress,
            stage=stage,
            message=message,
            can_use=can_use,
            error=error,
        )
    except Exception:
        logger.debug("Could not update F6 pipeline state", exc_info=True)


def run_step(name: str, module_name: str, image_root: Path, out_file: Path, resume: bool) -> bool:
    """Import the module and call its run() function. Returns True on success."""
    try:
        import importlib
        mod = importlib.import_module(module_name)
    except ImportError as e:
        logger.warning(f"[{name}] Skipped — missing dependency: {e}")
        return False

    try:
        logger.info(f"[{name}] Starting…")
        mod.run(image_root, out_file, resume=resume)
        logger.info(f"[{name}] Done → {out_file}")
        return True
    except Exception as e:
        logger.error(f"[{name}] Failed: {e}", exc_info=True)
        try:
            from backend.f6_attributes.fallback_features import FALLBACK_RUNNERS
            fallback = FALLBACK_RUNNERS.get(name)
            if fallback is None:
                return False
            logger.warning(f"[{name}] Falling back to portable extractor")
            fallback(image_root, out_file, resume=resume)
            logger.info(f"[{name}] Fallback done → {out_file}")
            return True
        except Exception as fallback_error:
            logger.error(f"[{name}] Fallback failed: {fallback_error}", exc_info=True)
            return False


# ---------------------------------------------------------------------------
# Artwork metadata (artist / title / origin region)
# ---------------------------------------------------------------------------

# WikiArt records an artist's nationality ("French", "Americans", ...). The
# globe filters by continent, so nationalities are folded into the regions the
# UI offers. Anything not listed stays unmapped rather than being guessed.
NATION_TO_REGION = {
    # europe
    "french": "europe", "germans": "europe", "german": "europe",
    "italians": "europe", "italian": "europe", "russians": "europe",
    "russian": "europe", "dutch": "europe", "british": "europe",
    "english": "europe", "spanish": "europe", "irishes": "europe",
    "irish": "europe", "flemish": "europe", "austrians": "europe",
    "austrian": "europe", "swiss": "europe", "belgians": "europe",
    "belgian": "europe", "norwegians": "europe", "norwegian": "europe",
    "swedes": "europe", "swedish": "europe", "danes": "europe",
    "danish": "europe", "polish": "europe", "poles": "europe",
    "greeks": "europe", "greek": "europe", "hungarians": "europe",
    "hungarian": "europe", "czechs": "europe", "czech": "europe",
    "portuguese": "europe", "finns": "europe", "finnish": "europe",
    "ukrainians": "europe", "ukrainian": "europe", "scottish": "europe",
    "romanians": "europe", "romanian": "europe", "serbians": "europe",
    "croatians": "europe", "slovenes": "europe", "slovenians": "europe",
    "bulgarians": "europe", "lithuanians": "europe", "latvians": "europe",
    "estonians": "europe", "icelandic": "europe", "welsh": "europe",
    # americas
    "americans": "americas", "american": "americas",
    "canadians": "americas", "canadian": "americas",
    "brazilians": "americas", "brazilian": "americas",
    "mexicans": "americas", "mexican": "americas",
    "argentines": "americas", "argentinians": "americas",
    "cubans": "americas", "chileans": "americas", "colombians": "americas",
    "peruvians": "americas", "uruguayans": "americas", "venezuelans": "americas",
    # asia
    "japanese": "asia", "chinese": "asia", "indians": "asia", "indian": "asia",
    "koreans": "asia", "korean": "asia", "iranians": "asia", "persians": "asia",
    "turks": "asia", "turkish": "asia", "israelis": "asia", "israeli": "asia",
    "armenians": "asia", "armenian": "asia", "georgians": "asia",
    "vietnamese": "asia", "indonesians": "asia", "filipinos": "asia",
    "thai": "asia", "lebanese": "asia", "syrians": "asia", "iraqis": "asia",
    "pakistanis": "asia", "azerbaijanis": "asia", "uzbeks": "asia",
    # africa
    "egyptians": "africa", "egyptian": "africa",
    "south africans": "africa", "nigerians": "africa", "moroccans": "africa",
    "algerians": "africa", "tunisians": "africa", "ethiopians": "africa",
    "ghanaians": "africa", "kenyans": "africa", "sudanese": "africa",
    # oceania
    "australians": "oceania", "australian": "oceania",
    "new zealanders": "oceania",
}


def _region_from_nations(nations) -> str | None:
    """First recognised nationality wins; unknown nationalities map to nothing."""
    if nations is None:
        return None
    if isinstance(nations, str):
        candidates = [nations]
    else:
        try:
            candidates = list(nations)
        except TypeError:
            return None

    for nation in candidates:
        region = NATION_TO_REGION.get(str(nation).strip().lower())
        if region:
            return region
    return None


def _wikiart_meta_lookup() -> dict[str, dict]:
    """filename -> {artist, title, year, region} from the WikiArt parquet."""
    parquet_path = (
        Path(__file__).resolve().parents[2]
        / "data" / "WikiArt_dataset" / "WikiArt.parquet"
    )
    if not parquet_path.exists():
        logger.warning(
            "WikiArt metadata not found at %s - paintings will have no artist, "
            "title or origin region, so the globe's origin filter cannot match.",
            parquet_path,
        )
        return {}

    try:
        import pandas as pd

        frame = pd.read_parquet(
            parquet_path,
            columns=["filename", "artist", "title", "completion", "artist_nations"],
        )
    except Exception:
        logger.warning(
            "Could not read WikiArt metadata from %s - paintings will have no "
            "origin region. Is a parquet engine (pyarrow) installed?",
            parquet_path,
            exc_info=True,
        )
        return {}

    lookup: dict[str, dict] = {}
    for row in frame.to_dict("records"):
        filename = str(row.get("filename") or "")
        if not filename:
            continue

        year = None
        completion = row.get("completion")
        try:
            if completion is not None and str(completion) not in {"nan", "<NA>", "None"}:
                year = int(float(completion))
        except (TypeError, ValueError):
            year = None

        lookup[filename] = {
            "artist": str(row.get("artist") or "") or None,
            "title": str(row.get("title") or "") or None,
            "year": year,
            "region": _region_from_nations(row.get("artist_nations")),
        }

    return lookup


# ---------------------------------------------------------------------------
# Index builder
# ---------------------------------------------------------------------------

def build_unified_index(output_dir: Path) -> None:
    """
    Merge all JSON outputs into a single per-painting index.
    Keys are painting IDs (relative paths).

    The unified index has one entry per painting with all available features
    as sub-dicts, e.g.:
    {
      "id":    "impressionism/monet/1876_sunrise.jpg",
      "path":  "/data/...",
      "features": {
        "pose":    {...},
        "color":   {...},
        "hough":   {...},
        "portrait_pose": {...}
      }
    }
    """
    from backend.f6_attributes.utils import load_json, save_json

    feature_files = {
        "pose":          output_dir / "poses.json",
        "color":         output_dir / "colors.json",
        "hough":         output_dir / "hough.json",
        "portrait_pose": output_dir / "portrait_poses.json",
    }

    # Load all available features
    feature_data: dict[str, dict[str, dict]] = {}
    for feat, fpath in feature_files.items():
        if not fpath.exists():
            continue
        records = load_json(fpath)
        feature_data[feat] = {r["id"]: r for r in records}
        logger.info(f"Loaded {len(feature_data[feat])} records for feature '{feat}'")

    # Gather all known IDs
    all_ids: set[str] = set()
    for feat_map in feature_data.values():
        all_ids.update(feat_map.keys())

    meta_lookup = _wikiart_meta_lookup()

    # Build unified records
    index = []
    with_region = 0
    for img_id in sorted(all_ids):
        # Grab path from whichever feature has it
        path = None
        for feat_map in feature_data.values():
            if img_id in feat_map:
                path = feat_map[img_id].get("path")
                break

        entry: dict = {"id": img_id, "path": path, "features": {}}

        for feat, feat_map in feature_data.items():
            if img_id in feat_map:
                rec = dict(feat_map[img_id])
                # Remove top-level id/path duplication inside features
                rec.pop("id", None)
                rec.pop("path", None)
                entry["features"][feat] = rec

        # features.meta carries artist/title/year plus the origin region the
        # globe filters on. Without it the origin filter can never match.
        filename = Path(str(path or img_id)).name
        meta = dict(meta_lookup.get(filename) or {})
        if meta.get("region"):
            with_region += 1
        entry["features"]["meta"] = meta

        index.append(entry)

    out_path = output_dir / "index.json"
    save_json(index, out_path)
    logger.info(f"Unified index: {len(index)} paintings → {out_path}")
    logger.info(
        f"Origin region resolved for {with_region}/{len(index)} paintings "
        f"({len(index) - with_region} have no known nationality)"
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    parser = argparse.ArgumentParser(
        description="Run all painting CV analysis pipelines",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("image_root", help="Root directory of painting images")
    parser.add_argument("output_dir", help="Directory to write all JSON output files")
    parser.add_argument(
        "--steps",
        nargs="+",
        choices=[s[0] for s in STEPS] + ["all"],
        default=["all"],
        help="Which steps to run (default: all)",
    )
    parser.add_argument("--no-resume", action="store_true", help="Re-process everything from scratch")
    parser.add_argument("--skip-index", action="store_true", help="Skip building the unified index")
    parser.add_argument("--state-file", type=Path, default=None, help="Pipeline state JSON file")
    parser.add_argument("--pipeline-name", default="f6", help="Pipeline key inside state file")
    args = parser.parse_args()

    image_root = Path(args.image_root)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not image_root.exists():
        logger.error(f"Image root does not exist: {image_root}")
        _write_state(
            args.state_file,
            args.pipeline_name,
            progress=0,
            stage="failed",
            message=f"Image root does not exist: {image_root}",
            status="failed",
            error=f"Image root does not exist: {image_root}",
        )
        sys.exit(1)

    selected = set(args.steps) if "all" not in args.steps else {s[0] for s in STEPS}
    resume = not args.no_resume
    selected_steps = [step for step in STEPS if step[0] in selected]

    # Add this directory to sys.path so sub-modules are importable
    sys.path.insert(0, str(Path(__file__).parent))

    results = {}
    total_steps = max(len(selected_steps), 1)
    _write_state(
        args.state_file,
        args.pipeline_name,
        progress=14,
        stage="analysis",
        message=f"Preparing {len(selected_steps)} F6 feature steps",
    )

    for index, (name, module_name, out_filename) in enumerate(selected_steps):
        start_progress = 14 + 68 * (index / total_steps)
        _write_state(
            args.state_file,
            args.pipeline_name,
            progress=start_progress,
            stage=name,
            message=f"Running F6 {name} step {index + 1}/{total_steps}",
        )
        out_file = output_dir / out_filename
        results[name] = run_step(name, module_name, image_root, out_file, resume)
        end_progress = 14 + 68 * ((index + 1) / total_steps)
        _write_state(
            args.state_file,
            args.pipeline_name,
            progress=end_progress,
            stage=name,
            message=(
                f"Finished F6 {name} step {index + 1}/{total_steps}"
                if results[name]
                else f"F6 {name} step {index + 1}/{total_steps} failed or was skipped"
            ),
        )

    # Summary
    print("\n" + "=" * 50)
    print("Pipeline summary:")
    for name, ok in results.items():
        status = "✓ OK" if ok else "✗ FAILED / SKIPPED"
        print(f"  {name:<20} {status}")
    print("=" * 50)

    if not args.skip_index:
        logger.info("Building unified index…")
        _write_state(
            args.state_file,
            args.pipeline_name,
            progress=90,
            stage="index",
            message="Building F6 unified attribute index",
        )
        build_unified_index(output_dir)
        _write_state(
            args.state_file,
            args.pipeline_name,
            progress=96,
            stage="index",
            message="F6 unified attribute index written",
        )

    if not all(results.values()):
        logger.error("One or more requested F6 steps failed.")
        _write_state(
            args.state_file,
            args.pipeline_name,
            progress=0,
            stage="failed",
            message="One or more F6 feature steps failed",
            status="failed",
            error="One or more F6 feature steps failed",
        )
        sys.exit(1)

    _write_state(
        args.state_file,
        args.pipeline_name,
        progress=100,
        stage="ready",
        message="F6 attribute filters are ready",
        status="completed",
        can_use=True,
    )


if __name__ == "__main__":
    main()
