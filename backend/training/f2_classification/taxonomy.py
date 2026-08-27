"""Canonical F2 taxonomy + mapping from raw WikiArt metadata.

The on-disk WikiArt dataset (Internet Archive `WikiArt_dataset`) uses the modern
WikiArt taxonomy (~166 styles, ~57 genres, ~2000 artists). The F2 runtime, the
thesis, and the reference article (Saleh & Elgammal) use the classic reduced
taxonomy: 27 styles and 10 genres. This module maps raw labels onto that classic
taxonomy so the trained model stays compatible with the app's expectations
(`classifier.DEFAULT_LABELS`, `STYLE_ECHOES`).

Artists are NOT fixed here: they are selected data-driven (top-K by frequency)
in `prepare_dataset.py`, because a smaller, well-populated author set gives much
higher accuracy.
"""

from __future__ import annotations

import unicodedata

# The 27 canonical styles (matches classifier.DEFAULT_LABELS["styles"]).
CANONICAL_STYLES: list[str] = [
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
]

# The 10 canonical genres (matches classifier.DEFAULT_LABELS["genres"]).
CANONICAL_GENRES: list[str] = [
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
]


def _norm(value: str) -> str:
    """Lowercase, strip accents and punctuation noise for tolerant matching."""
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().strip()
    for ch in "()[]":
        text = text.replace(ch, " ")
    text = text.replace("-", " ").replace("_", " ")
    return " ".join(text.split())


# Raw style name (normalized) -> canonical style.
# Built from the canonical names themselves plus the modern-WikiArt aliases that
# differ in punctuation/spelling.
_STYLE_ALIASES: dict[str, str] = {
    "post impressionism": "Post Impressionism",
    "art nouveau modern": "Art Nouveau-Modern Art",
    "art nouveau": "Art Nouveau-Modern Art",
    "naive art primitivism": "Primitivism-Naive Art",
    "primitivism": "Primitivism-Naive Art",
    "mannerism late renaissance": "Mannerism-Late Renaissance",
    "mannerism": "Mannerism-Late Renaissance",
    "new realism": "New Realism",
    "ukiyo e": "Ukiyo-e",
}

# Raw genre name (normalized) -> canonical genre.
_GENRE_ALIASES: dict[str, str] = {
    "portrait": "Portrait",
    "self portrait": "Portrait",
    "tronie": "Portrait",
    "landscape": "Landscape",
    "cloudscape": "Landscape",
    "marina": "Landscape",
    "genre painting": "Genre Painting",
    "abstract": "Abstract Painting",
    "abstract painting": "Abstract Painting",
    "religious painting": "Religious Painting",
    "icon": "Religious Painting",
    "cityscape": "Cityscape",
    "veduta": "Cityscape",
    "sketch and study": "Sketch and Study",
    "illustration": "Illustration",
    "still life": "Still Life",
    "nude painting nu": "Nude Painting",
    "nude painting": "Nude Painting",
}


def _build_style_lookup() -> dict[str, str]:
    lookup = {_norm(name): name for name in CANONICAL_STYLES}
    lookup.update(_STYLE_ALIASES)
    return lookup


def _build_genre_lookup() -> dict[str, str]:
    lookup = {_norm(name): name for name in CANONICAL_GENRES}
    lookup.update(_GENRE_ALIASES)
    return lookup


_STYLE_LOOKUP = _build_style_lookup()
_GENRE_LOOKUP = _build_genre_lookup()


def map_style(raw: str | None) -> str | None:
    """Map a raw WikiArt style to its canonical form, or None if out of taxonomy."""
    if not raw:
        return None
    return _STYLE_LOOKUP.get(_norm(raw))


def map_genre(raw: str | None) -> str | None:
    """Map a raw WikiArt genre to its canonical form, or None if out of taxonomy."""
    if not raw:
        return None
    return _GENRE_LOOKUP.get(_norm(raw))


def first_or_none(values) -> str | None:
    """WikiArt stores styles/genres as lists; take the primary (first) entry."""
    if isinstance(values, list):
        return values[0] if values else None
    if isinstance(values, str):
        return values or None
    return None
