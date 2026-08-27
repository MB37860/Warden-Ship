"""Build a natural-language caption for a WikiArt row (shared by train + eval).

The F2 package rows look like:
    {"image": "...", "style": "Impressionism", "genre": "Landscape", "artist": "Claude Monet"}
Any field may be null. The caption uses whatever is present so CLIP learns to
align paintings with art vocabulary (movements, genres, painter names).
"""

from __future__ import annotations


def build_caption(row: dict) -> str:
    style = (row.get("style") or "").strip()
    genre = (row.get("genre") or "").strip().lower()
    artist = (row.get("artist") or "").strip()

    subject = f"{style} {genre}".strip() if style else (genre or "painting")
    if genre and "painting" not in subject:
        subject = f"{subject} painting"
    elif not genre and style:
        subject = f"{subject} painting"

    caption = f"a {subject}" if subject else "a painting"
    if artist:
        caption += f" by {artist}"
    return caption
