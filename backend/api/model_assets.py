"""Trained artifacts the app fetches from the Hugging Face Hub.

Three of the four models this app runs are too large to ship inside the
installer - GitHub caps a release asset at 2 GB and the installer is already
1.5 GB - so they live in public model repos and are pulled on first use into
the Hugging Face cache (``HF_HOME``, pointed at the per-user data directory in
a packaged build, so uninstalling takes them with it).

Resolution order for every asset: the copy under ``data/`` if a checkout or a
locally built installer has one, then the Hub cache, then a download. Nothing
here raises on failure - a missing artifact means the weaker fallback each
caller already implements, not a broken app.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class ModelAsset:
    key: str
    repo_id: str
    local_dir: str
    # Individual files to fetch; empty means the whole repo is an HF model
    # directory that transformers loads by name.
    files: tuple[str, ...]
    # The file whose presence proves the local copy is complete.
    marker: str
    megabytes: int
    feature: str
    degraded: str


ASSETS: dict[str, ModelAsset] = {
    "clip_art": ModelAsset(
        key="clip_art",
        repo_id="breskvarmatej/warden-ship-clip-art",
        local_dir="clip_art",
        files=(),
        marker="model.safetensors",
        megabytes=581,
        feature="F1 typed search, and every embedding the app stores",
        degraded="base CLIP (zero-shot style 0.55 -> 0.26)",
    ),
    "f1_embed": ModelAsset(
        key="f1_embed",
        repo_id="breskvarmatej/warden-ship-f1-embed",
        local_dir="f1_embed",
        files=("f1_embed_model.pt", "f1_embed_labels.json"),
        marker="f1_embed_model.pt",
        megabytes=330,
        feature="clustering and neighbours on the F5 history map",
        degraded="visual descriptors (style p@1 0.61 -> 0.42)",
    ),
    "f2_vitl336": ModelAsset(
        key="f2_vitl336",
        repo_id="breskvarmatej/warden-ship-f2-vitl336",
        local_dir="f2_dataset_hires",
        files=("f2_image_model.pt", "f2_labels.json"),
        marker="f2_image_model.pt",
        megabytes=1160,
        feature="F2 style / genre / artist classification",
        degraded="CLIP zero-shot (style 77.0% -> 25.8%)",
    ),
}


def _bundled_dir(asset: ModelAsset) -> Path | None:
    """The copy staged into the build or sitting in a dev checkout."""
    directory = _REPO_ROOT / "data" / asset.local_dir
    return directory if (directory / asset.marker).exists() else None


def _hub():
    try:
        import huggingface_hub
    except Exception:
        return None
    return huggingface_hub


def is_cached(asset: ModelAsset) -> bool:
    """Whether the Hub copy is already on disk, without touching the network."""
    hub = _hub()
    if hub is None:
        return False
    try:
        return hub.try_to_load_from_cache(asset.repo_id, asset.marker) is not None
    except Exception:
        return False


def resolve_model_dir(key: str) -> str | None:
    """Argument for ``from_pretrained``: a local directory, or the repo id.

    Returning the repo id is what makes the download happen - transformers
    resolves and caches it. None when the asset is unknown.
    """
    asset = ASSETS.get(key)
    if asset is None:
        return None
    bundled = _bundled_dir(asset)
    return str(bundled) if bundled is not None else asset.repo_id


def resolve_file(key: str, filename: str, *, download: bool = True) -> Path | None:
    """Local path to one file of an asset, fetching it from the Hub if needed.

    ``download=False`` answers only from what is already on disk, which is what
    the status endpoint needs.
    """
    asset = ASSETS.get(key)
    if asset is None:
        return None

    bundled = _bundled_dir(asset)
    if bundled is not None and (bundled / filename).exists():
        return bundled / filename

    hub = _hub()
    if hub is None:
        return None

    try:
        if not download:
            cached = hub.try_to_load_from_cache(asset.repo_id, filename)
            return Path(cached) if isinstance(cached, str) else None
        return Path(hub.hf_hub_download(asset.repo_id, filename))
    except Exception as error:
        print(
            f"[models] could not fetch {filename} from {asset.repo_id}: "
            f"{type(error).__name__}: {error}",
            flush=True,
        )
        return None


def fetch(key: str) -> bool:
    """Download an asset in full. True when it is on disk afterwards."""
    asset = ASSETS.get(key)
    if asset is None:
        return False
    if _bundled_dir(asset) is not None:
        return True

    hub = _hub()
    if hub is None:
        return False

    try:
        if asset.files:
            for filename in asset.files:
                hub.hf_hub_download(asset.repo_id, filename)
        else:
            hub.snapshot_download(asset.repo_id)
        return True
    except Exception as error:
        print(
            f"[models] download of {asset.repo_id} failed: "
            f"{type(error).__name__}: {error}",
            flush=True,
        )
        return False


def status() -> list[dict]:
    """Per-asset availability, for the interface and the health endpoint."""
    report = []
    for asset in ASSETS.values():
        bundled = _bundled_dir(asset)
        if bundled is not None:
            source = "bundled"
        elif is_cached(asset):
            source = "downloaded"
        else:
            source = "absent"
        report.append(
            {
                "key": asset.key,
                "repo_id": asset.repo_id,
                "source": source,
                "ready": source != "absent",
                "megabytes": asset.megabytes,
                "feature": asset.feature,
                "degraded": asset.degraded,
                "url": f"https://huggingface.co/{asset.repo_id}",
            }
        )
    return report
