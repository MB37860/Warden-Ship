from __future__ import annotations

import io
import os
import threading
import time
import traceback
from dataclasses import dataclass
from pathlib import Path

import numpy as np

torch = None
Image = None
CLIPModel = None
CLIPProcessor = None
_CLIP_IMPORT_ERROR: Exception | None = None
_CLIP_IMPORT_FAILED_AT = 0.0
# A failed import is worth retrying: the first attempt can lose a race with
# another thread importing transformers, or run out of memory while a pipeline
# is loading its own models. Retrying costs a few seconds, so rate-limit it
# rather than repeating a genuinely broken import on every request.
_IMPORT_RETRY_AFTER_S = 20.0
_IMPORT_LOCK = threading.Lock()
_RUNTIME_LOCK = threading.Lock()


def _normalize(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms = np.clip(norms, 1e-12, None)
    return vectors / norms


@dataclass
class _ClipRuntime:
    processor: object
    model: object
    device: str


_RUNTIME: _ClipRuntime | None = None


def clip_available() -> bool:
    """Whether CLIP can be used *now*.

    This must re-check rather than report a remembered verdict: a single failed
    import used to latch the answer to False for the life of the process, so
    the star atlas stayed "CLIP offline" even while embeddings were being
    computed successfully in another thread.
    """
    return _ensure_clip_imports()


def clip_error() -> str:
    """Why CLIP is unavailable, for the health endpoint and the logs."""
    return f"{type(_CLIP_IMPORT_ERROR).__name__}: {_CLIP_IMPORT_ERROR}" if _CLIP_IMPORT_ERROR else ""


def _imports_present() -> bool:
    return (
        CLIPModel is not None
        and CLIPProcessor is not None
        and Image is not None
        and torch is not None
    )


def _ensure_clip_imports() -> bool:
    global CLIPModel, CLIPProcessor, Image, torch
    global _CLIP_IMPORT_ERROR, _CLIP_IMPORT_FAILED_AT

    if _imports_present():
        return True
    if _CLIP_IMPORT_ERROR is not None and time.monotonic() - _CLIP_IMPORT_FAILED_AT < _IMPORT_RETRY_AFTER_S:
        return False

    # One importer at a time: two threads importing transformers concurrently
    # can see a partially initialised module and fail spuriously.
    with _IMPORT_LOCK:
        if _imports_present():
            return True

        try:
            import torch as torch_module
            from PIL import Image as image_module
            from transformers import CLIPModel as clip_model
            from transformers import CLIPProcessor as clip_processor
        except Exception as error:
            _CLIP_IMPORT_ERROR = error
            _CLIP_IMPORT_FAILED_AT = time.monotonic()
            # Never swallow this silently — it is the difference between "CLIP
            # is broken" and "CLIP was busy", and the packaged app has no
            # console to lose it to.
            print(f"[clip] import failed: {type(error).__name__}: {error}", flush=True)
            traceback.print_exc()
            return False

        torch = torch_module
        Image = image_module
        CLIPModel = clip_model
        CLIPProcessor = clip_processor
        _CLIP_IMPORT_ERROR = None
        return True


_BASE_CLIP = "openai/clip-vit-base-patch32"


def resolve_clip_model() -> str:
    """Pick the CLIP weights: env override > local fine-tuned dir > base model.

    The art-fine-tuned CLIP (see backend/training/f1_clip_finetune) lives in
    ``data/clip_art`` at the repo root and is preferred when present because it
    is markedly better on art vocabulary (zero-shot style 0.55 vs 0.26).
    """
    override = os.getenv("CLIP_MODEL_PATH", "").strip()
    if override:
        return override
    fine_tuned = Path(__file__).resolve().parents[2] / "data" / "clip_art"
    if (fine_tuned / "model.safetensors").exists():
        return str(fine_tuned)
    return _BASE_CLIP


def clip_model_tag() -> str:
    """Short identifier of the active CLIP weights (stored next to embeddings)."""
    resolved = resolve_clip_model()
    return "clip-art-ft" if resolved != _BASE_CLIP else "clip-base"


def _get_runtime(model_name: str | None = None) -> _ClipRuntime | None:
    global _RUNTIME

    if not _ensure_clip_imports():
        return None

    if _RUNTIME is not None:
        return _RUNTIME

    # One loader at a time: the weights are hundreds of MB, and two threads
    # loading them at once doubles the peak memory for no benefit.
    with _RUNTIME_LOCK:
        if _RUNTIME is not None:
            return _RUNTIME

        resolved = model_name or resolve_clip_model()
        device = "cuda" if torch.cuda.is_available() else "cpu"
        try:
            processor = CLIPProcessor.from_pretrained(resolved)
            model = CLIPModel.from_pretrained(resolved).to(device)
        except Exception as error:
            if resolved == _BASE_CLIP:
                # First use downloads the weights; on a machine with no network
                # this is where it fails, and the caller only sees None.
                print(f"[clip] could not load {resolved}: {type(error).__name__}: {error}", flush=True)
                raise
            # Fine-tuned dir unusable (missing/corrupt) - fall back to base CLIP.
            print(f"[clip] {resolved} unusable ({error}); falling back to {_BASE_CLIP}", flush=True)
            processor = CLIPProcessor.from_pretrained(_BASE_CLIP)
            model = CLIPModel.from_pretrained(_BASE_CLIP).to(device)
        model.eval()
        _RUNTIME = _ClipRuntime(processor=processor, model=model, device=device)
        return _RUNTIME


def _feature_tensor(
    features: object,
    embedding_attribute: str,
):
    if torch.is_tensor(features):
        return features

    embedding = getattr(features, embedding_attribute, None)
    if torch.is_tensor(embedding):
        return embedding

    pooled_output = getattr(features, "pooler_output", None)
    if torch.is_tensor(pooled_output):
        return pooled_output

    raise RuntimeError("CLIP returned an unsupported feature output")


def embed_images(image_bytes_list: list[bytes]) -> np.ndarray | None:
    runtime = _get_runtime()
    if runtime is None or not image_bytes_list:
        return None

    pil_images = []
    for raw in image_bytes_list:
        with Image.open(io.BytesIO(raw)) as image:
            pil_images.append(image.convert("RGB"))

    with torch.inference_mode():
        encoded = runtime.processor(images=pil_images, return_tensors="pt", padding=True)
        encoded = {key: value.to(runtime.device) for key, value in encoded.items()}
        features = runtime.model.get_image_features(**encoded)
        features = _feature_tensor(
            features,
            embedding_attribute="image_embeds",
        )
        vectors = features.detach().cpu().numpy().astype(np.float32)
    return _normalize(vectors).astype(np.float32)


def embed_text(text: str) -> np.ndarray | None:
    runtime = _get_runtime()
    if runtime is None:
        return None

    query = (text or "").strip()
    if not query:
        return None

    with torch.inference_mode():
        encoded = runtime.processor(text=[query], return_tensors="pt", padding=True)
        encoded = {key: value.to(runtime.device) for key, value in encoded.items()}
        features = runtime.model.get_text_features(**encoded)
        features = _feature_tensor(
            features,
            embedding_attribute="text_embeds",
        )
        vector = features.detach().cpu().numpy().astype(np.float32)
    return _normalize(vector).astype(np.float32)[0]
