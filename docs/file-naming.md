# File Naming Rules

The current uploaded archive format is:

```text
0000002_Ivan Aivazovsky - Storm at Sea.jpg
```

Raw filenames may include a leading catalog id, then the artist, then the artwork title.

Rules:

1. Keep raw filenames and file ids for storage, matching, downloads, and API calls.
2. Do not show raw catalog ids in the UI.
3. Prefer `metadata.artist` or an explicit `artist` field when available.
4. If only a filename exists, strip the folder, URL query, extension, and leading id.
5. For `id_Author Name - Artwork Title.ext`, show `Author Name`.
6. If no author can be found, show a cleaned basename instead of the raw filename.
7. The F2 logbook displays and classifies only files without both a recognized
   artist and artwork title, including labels such as `Unknown Artist`.
