from __future__ import annotations

import hashlib
import io
import json
import os
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

try:
    import torch
except Exception:  # pragma: no cover - torch is optional for fallback
    torch = None

DEFAULT_LABELS = {
    "styles": [
        "Abstract Expressionism",
        "Action Painting",
        "Analytical Cubism",
        "Art Nouveau-Modern Art",
        "Baroque",
        "Color Field Painting",
        "Contemporary Realism",
        "Cubism",
        "Early Renaissance",
        "Expressionism",
        "Fauvism",
        "High Renaissance",
        "Impressionism",
        "Mannerism-Late Renaissance",
        "Minimalism",
        "Primitivism-Naive Art",
        "New Realism",
        "Northern Renaissance",
        "Pointillism",
        "Pop Art",
        "Post Impressionism",
        "Realism",
        "Rococo",
        "Romanticism",
        "Symbolism",
        "Synthetic Cubism",
        "Ukiyo-e",
    ],
    "genres": [
        "Abstract Painting",
        "Cityscape",
        "Genre Painting",
        "Illustration",
        "Landscape",
        "Nude Painting",
        "Portrait",
        "Religious Painting",
        "Sketch and Study",
        "Still Life",
    ],
    "artists": [
        "Albrecht Durer",
        "Boris Kustodiev",
        "Camille Pissarro",
        "Childe Hassam",
        "Claude Monet",
        "Edgar Degas",
        "Eugene Boudin",
        "Gustave Dore",
        "Ilya Repin",
        "Ivan Aivazovsky",
        "Ivan Shishkin",
        "John Singer Sargent",
        "Marc Chagall",
        "Martiros Saryan",
        "Nicholas Roerich",
        "Pablo Picasso",
        "Paul Cezanne",
        "Pierre-Auguste Renoir",
        "Pyotr Konchalovsky",
        "Raphael Kirchner",
        "Rembrandt",
        "Salvador Dali",
        "Vincent van Gogh",
    ],
}

STYLE_ECHOES = {
    "Abstract Expressionism": ["Action Painting", "Color Field Painting"],
    "Action Painting": ["Abstract Expressionism", "Color Field Painting"],
    "Impressionism": ["Post Impressionism", "Realism"],
    "Post Impressionism": ["Impressionism", "Symbolism"],
    "Mannerism-Late Renaissance": ["High Renaissance", "Early Renaissance"],
    "High Renaissance": ["Early Renaissance", "Mannerism-Late Renaissance"],
    "Cubism": ["Analytical Cubism", "Synthetic Cubism"],
    "Analytical Cubism": ["Cubism", "Synthetic Cubism"],
    "Synthetic Cubism": ["Cubism", "Analytical Cubism"],
    "Northern Renaissance": ["Early Renaissance", "High Renaissance"],
    "Rococo": ["Baroque", "Romanticism"],
    "Ukiyo-e": ["Art Nouveau-Modern Art", "Impressionism"],
}

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# --- Open-set artist recognition -------------------------------------------
# The artist head is trained on a closed set of 25 painters, so softmax always
# nominates one of them - even for paintings by completely different artists.
# When the top probability is below a calibrated threshold we reject it: the
# label becomes "Unknown artist" (known=False) and the would-be top guess is
# kept only as a "closest" reference, rather than forcing one of the 25. The
# threshold is calibrated on the held-out test set (300 known-artist vs 300
# outside-top-25 paintings; see docs/evaluation/f2_artist_openset_calibration.json).
UNKNOWN_ARTIST_LABEL = "Unknown artist"


def _artist_unknown_threshold(env_name: str, default: float) -> float:
    try:
        return float(os.getenv(env_name, str(default)))
    except ValueError:
        return default


# Calibrated defaults (max balanced accuracy of known-kept vs unknown-rejected
# on 300+300 held-out test paintings):
#  - ViT-L/336 (the app default model): threshold 0.49 -> keeps 92.7% of
#    known-artist paintings, rejects 93.3% of outside-top-25 paintings
#    (known median max-prob 0.88 vs unknown 0.11);
#  - the ViT-B/224 baseline is far more overconfident: its optimum is 0.95
#    (keeps 86%, rejects 71%) - set F2_ARTIST_UNKNOWN_THRESHOLD=0.95 with it;
#  - CLIP zero-shot fallback (softmax over 25 prompts is much flatter):
#    threshold 0.13 -> keeps 67% known, rejects 85% unknown.
_MODEL_UNKNOWN_DEFAULT = 0.49
_ZS_UNKNOWN_DEFAULT = 0.13


def _apply_artist_open_set(prediction: dict, threshold: float) -> dict:
    confidence = float(prediction.get("confidence") or 0.0)
    if confidence >= threshold:
        prediction["known"] = True
        return prediction

    prediction["known"] = False
    prediction["closest"] = {
        "label": prediction.get("label"),
        "confidence": confidence,
    }
    prediction["label"] = UNKNOWN_ARTIST_LABEL
    prediction["note"] = (
        "The painting does not match any of the 25 artists the model knows; "
        "the closest known artist is shown for reference."
    )
    return prediction


@dataclass
class F2Runtime:
    model: Any | None
    labels: dict[str, list[str]]
    device: str
    model_kind: str
    available: bool
    last_error: str | None
    model_path: Path | None
    labels_path: Path | None
    input_size: int = 224


_RUNTIME: F2Runtime | None = None
_CLIP_LABEL_CACHE: dict[tuple[str, tuple[str, ...]], np.ndarray] = {}


def _load_labels_from_path(path: Path) -> dict[str, list[str]] | None:
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        styles = data.get("styles")
        genres = data.get("genres")
        artists = data.get("artists")
        if not all(isinstance(value, list) for value in (styles, genres, artists)):
            return None
        return {
            "styles": [str(item) for item in styles],
            "genres": [str(item) for item in genres],
            "artists": [str(item) for item in artists],
        }
    except Exception:
        return None


def _resolve_labels() -> tuple[dict[str, list[str]], Path | None]:
    labels_path = Path(os.getenv("F2_LABELS_PATH", "")).expanduser()
    if not (labels_path and labels_path.exists()):
        labels_path = _hub_file("f2_labels.json")
    if labels_path and labels_path.exists():
        labels = _load_labels_from_path(labels_path)
        if labels:
            return labels, labels_path
    return DEFAULT_LABELS, None


def _hub_file(filename: str) -> Path | None:
    """The classifier's weights from data/ or the public Hub repo.

    F2 is the one feature with no path auto-discovery of its own - it has only
    ever read F2_MODEL_PATH - so without this a packaged app that could not
    bundle the 1.2 GB model silently served CLIP zero-shot instead.
    """
    try:
        from backend.api import model_assets
    except Exception:
        return None
    return model_assets.resolve_file("f2_vitl336", filename)


def _resolve_device() -> str:
    requested = os.getenv("F2_MODEL_DEVICE", "cpu").strip().lower()
    if requested.startswith("cuda") and torch is not None and torch.cuda.is_available():
        return requested
    return "cpu"


def _load_model(model_path: Path, device: str) -> Any | None:
    if torch is None:
        return None
    try:
        model = torch.jit.load(str(model_path), map_location=device)
        model.eval()
        return model
    except Exception:
        pass

    try:
        model = torch.load(str(model_path), map_location=device)
        if hasattr(model, "eval"):
            model.eval()
            return model
    except Exception:
        return None
    return None


def _resolve_model_kind() -> str:
    kind = os.getenv("F2_MODEL_KIND", "image").strip().lower()
    return kind if kind in {"image", "clip-linear"} else "image"


def _input_size(default: int = 224) -> int:
    # The exported image model is trained at a fixed resolution (224 for the
    # baseline, 336 for the high-res ViT-L run). F2_INPUT_SIZE wins; otherwise
    # the caller passes the resolution matching the weights it actually loaded,
    # because preprocessing a 336 model at 224 quietly wrecks its accuracy.
    try:
        return int(os.getenv("F2_INPUT_SIZE", str(default)))
    except ValueError:
        return default


def get_runtime() -> F2Runtime:
    global _RUNTIME
    if _RUNTIME is not None:
        return _RUNTIME

    labels, labels_path = _resolve_labels()
    model_path_value = os.getenv("F2_MODEL_PATH", "").strip()
    model_path = Path(model_path_value).expanduser() if model_path_value else None
    # The Hub asset is specifically the ViT-L/336 run, so its resolution is
    # known even when nothing set F2_INPUT_SIZE.
    from_hub = model_path is None or not model_path.exists()
    if from_hub:
        model_path = _hub_file("f2_image_model.pt")
    device = _resolve_device()
    model_kind = _resolve_model_kind()
    model = None
    available = False
    last_error = None

    if model_path and model_path.exists():
        model = _load_model(model_path, device)
        if model is None:
            last_error = "Model file found but could not be loaded"
        else:
            available = True
    else:
        last_error = "Model file not available locally or from the Hub"

    _RUNTIME = F2Runtime(
        model=model,
        labels=labels,
        device=device,
        model_kind=model_kind,
        input_size=_input_size(336 if from_hub else 224),
        available=available,
        last_error=last_error,
        model_path=model_path if model_path and model_path.exists() else None,
        labels_path=labels_path,
    )
    return _RUNTIME


def _normalize_label(value: str) -> str:
    return (
        str(value)
        .strip()
        .lower()
        .replace("_", " ")
        .replace("-", " ")
    )


def _find_hint_label(hint: Any, labels: list[str]) -> str | None:
    if hint is None:
        return None
    if isinstance(hint, list):
        for item in hint:
            label = _find_hint_label(item, labels)
            if label:
                return label
        return None
    needle = _normalize_label(str(hint))
    for label in labels:
        if _normalize_label(label) == needle:
            return label
    return None


def _preprocess_image(image_bytes: bytes, size: int = 224) -> np.ndarray:
    # Resize shorter side to 256, center-crop `size`, scale to [0,1] CHW.
    # The exported F2 image model (backend/training/f2_classification/train_f2.py) bakes in its own
    # normalisation, so we deliberately do NOT apply mean/std here. This must
    # match backend/training/f2_classification/train_f2.py eval transform and evaluate_testset.preprocess.
    resize_to = int(size * 256 / 224)
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    width, height = image.size
    if width <= height:
        new_size = (resize_to, max(1, round(height * resize_to / width)))
    else:
        new_size = (max(1, round(width * resize_to / height)), resize_to)
    image = image.resize(new_size, Image.BICUBIC)
    width, height = image.size
    left = (width - size) // 2
    top = (height - size) // 2
    image = image.crop((left, top, left + size, top + size))
    array = np.asarray(image).astype(np.float32) / 255.0
    return array.transpose(2, 0, 1)


def _softmax(logits: Any) -> np.ndarray:
    if torch is not None and isinstance(logits, torch.Tensor):
        return torch.softmax(logits, dim=-1).detach().cpu().numpy()
    array = np.asarray(logits, dtype=np.float32)
    array = array - np.max(array)
    exp = np.exp(array)
    return exp / (exp.sum() + 1e-9)


def _confidence_band(value: float) -> str:
    if value >= 0.72:
        return "radiant"
    if value >= 0.55:
        return "steady"
    if value >= 0.38:
        return "misty"
    return "faint"


def _seed_from_bytes(image_bytes: bytes, salt: str) -> int:
    digest = hashlib.blake2b(image_bytes, digest_size=8, salt=salt.encode("utf-8")).digest()
    return int.from_bytes(digest, "big")


def _random_distribution(labels: list[str], seed: int) -> list[float]:
    rng = random.Random(seed)
    raw = [rng.random() ** 1.7 + 0.02 for _ in labels]
    total = sum(raw) or 1.0
    return [value / total for value in raw]


def _apply_hint(probabilities: list[float], labels: list[str], hint_label: str | None) -> list[float]:
    if hint_label is None:
        return probabilities
    try:
        index = labels.index(hint_label)
    except ValueError:
        return probabilities

    boosted = list(probabilities)
    boosted[index] = max(boosted[index], 0.48)
    total = sum(boosted) or 1.0
    return [value / total for value in boosted]


def _build_top_predictions(labels: list[str], probabilities: list[float], top_k: int) -> dict:
    ranked = sorted(
        ((label, float(score)) for label, score in zip(labels, probabilities)),
        key=lambda item: item[1],
        reverse=True,
    )
    top = ranked[: max(1, min(top_k, len(ranked)))]
    primary_label, primary_score = top[0]
    return {
        "label": primary_label,
        "confidence": primary_score,
        "band": _confidence_band(primary_score),
        "alternatives": [
            {
                "label": label,
                "confidence": score,
                "band": _confidence_band(score),
            }
            for label, score in top[1:]
        ],
    }


def _extract_logits(outputs: Any, key: str, index: int | None) -> Any | None:
    if isinstance(outputs, dict):
        for candidate in (key, f"{key}_logits", f"{key}_head", f"{key}_scores"):
            if candidate in outputs:
                return outputs[candidate]
        return None
    if isinstance(outputs, (list, tuple)) and index is not None and len(outputs) > index:
        return outputs[index]
    return None


def _predict_with_model(image_bytes: bytes, top_k: int) -> dict:
    runtime = get_runtime()
    if torch is None or runtime.model is None:
        raise RuntimeError("Model runtime unavailable")

    if runtime.model_kind == "clip-linear":
        try:
            from backend.api.clip_service import embed_images
        except Exception as exc:
            raise RuntimeError(f"CLIP runtime unavailable for F2 model: {exc}") from exc
        embedding = embed_images([image_bytes])
        if embedding is None:
            raise RuntimeError("CLIP runtime unavailable for F2 model")
        tensor = torch.from_numpy(embedding).to(runtime.device)
    else:
        array = _preprocess_image(image_bytes, size=runtime.input_size)
        tensor = torch.from_numpy(array).unsqueeze(0).to(runtime.device)

    with torch.inference_mode():
        outputs = runtime.model(tensor)

    style_logits = _extract_logits(outputs, "style", 0)
    genre_logits = _extract_logits(outputs, "genre", 1)
    artist_logits = _extract_logits(outputs, "artist", 2)

    if style_logits is None or genre_logits is None or artist_logits is None:
        raise RuntimeError("Model output does not include style/genre/artist heads")

    style_probs = _softmax(style_logits.squeeze())
    genre_probs = _softmax(genre_logits.squeeze())
    artist_probs = _softmax(artist_logits.squeeze())

    return {
        "style": _build_top_predictions(runtime.labels["styles"], style_probs.tolist(), top_k),
        "genre": _build_top_predictions(runtime.labels["genres"], genre_probs.tolist(), top_k),
        "artist": _apply_artist_open_set(
            _build_top_predictions(runtime.labels["artists"], artist_probs.tolist(), top_k),
            _artist_unknown_threshold("F2_ARTIST_UNKNOWN_THRESHOLD", _MODEL_UNKNOWN_DEFAULT),
        ),
    }


def _predict_fallback(image_bytes: bytes, top_k: int, hints: dict[str, Any] | None) -> dict:
    runtime = get_runtime()
    hint_style = _find_hint_label(hints.get("style") if hints else None, runtime.labels["styles"])
    hint_genre = _find_hint_label(hints.get("genre") if hints else None, runtime.labels["genres"])
    hint_artist = _find_hint_label(hints.get("artist") if hints else None, runtime.labels["artists"])

    style_seed = _seed_from_bytes(image_bytes, "style")
    genre_seed = _seed_from_bytes(image_bytes, "genre")
    artist_seed = _seed_from_bytes(image_bytes, "artist")

    style_probs = _apply_hint(_random_distribution(runtime.labels["styles"], style_seed), runtime.labels["styles"], hint_style)
    genre_probs = _apply_hint(_random_distribution(runtime.labels["genres"], genre_seed), runtime.labels["genres"], hint_genre)
    artist_probs = _apply_hint(_random_distribution(runtime.labels["artists"], artist_seed), runtime.labels["artists"], hint_artist)

    return {
        "style": _build_top_predictions(runtime.labels["styles"], style_probs, top_k),
        "genre": _build_top_predictions(runtime.labels["genres"], genre_probs, top_k),
        "artist": _build_top_predictions(runtime.labels["artists"], artist_probs, top_k),
    }


def _clip_prompts(kind: str, labels: list[str]) -> list[str]:
    if kind == "styles":
        return [f"a painting in the {label} style" for label in labels]
    if kind == "genres":
        return [f"a {label} painting" for label in labels]
    return [f"a painting by {label}" for label in labels]


def _clip_label_matrix(kind: str, labels: list[str]) -> np.ndarray:
    cache_key = (kind, tuple(labels))
    if cache_key in _CLIP_LABEL_CACHE:
        return _CLIP_LABEL_CACHE[cache_key]

    from backend.api.clip_service import embed_text

    vectors = []
    for prompt in _clip_prompts(kind, labels):
        vector = embed_text(prompt)
        if vector is None:
            raise RuntimeError("CLIP text runtime unavailable")
        vectors.append(vector)
    matrix = np.vstack(vectors).astype(np.float32)
    _CLIP_LABEL_CACHE[cache_key] = matrix
    return matrix


def _predict_with_clip(image_bytes: bytes, top_k: int) -> dict:
    from backend.api.clip_service import embed_images

    runtime = get_runtime()
    image_vector = embed_images([image_bytes])
    if image_vector is None:
        raise RuntimeError("CLIP image runtime unavailable")

    predictions = {}
    for key, labels in runtime.labels.items():
        label_matrix = _clip_label_matrix(key, labels)
        scores = label_matrix @ image_vector[0].astype(np.float32)
        probabilities = _softmax(scores * 12.0)
        predictions[{"styles": "style", "genres": "genre", "artists": "artist"}[key]] = (
            _build_top_predictions(labels, probabilities.tolist(), top_k)
        )
    predictions["artist"] = _apply_artist_open_set(
        predictions["artist"],
        _artist_unknown_threshold("F2_ARTIST_UNKNOWN_THRESHOLD_ZS", _ZS_UNKNOWN_DEFAULT),
    )
    return predictions


def classify_image(image_bytes: bytes, top_k: int = 5, hints: dict[str, Any] | None = None) -> dict:
    runtime = get_runtime()
    start = time.perf_counter()
    source = "model"

    try:
        if runtime.available:
            predictions = _predict_with_model(image_bytes, top_k)
        else:
            raise RuntimeError(runtime.last_error or "Model unavailable")
    except Exception:
        try:
            source = "clip-zero-shot"
            predictions = _predict_with_clip(image_bytes, top_k)
        except Exception:
            source = "fallback"
            predictions = _predict_fallback(image_bytes, top_k, hints)

    predictions["style"]["echoes"] = STYLE_ECHOES.get(predictions["style"]["label"], [])
    elapsed_ms = (time.perf_counter() - start) * 1000

    return {
        "source": source,
        "model_available": runtime.available,
        "elapsed_ms": round(elapsed_ms, 2),
        **predictions,
    }
