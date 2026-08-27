// Naming rules these helpers implement:
//   - Keep raw filenames and ids only for storage, lookup, downloads, and API calls.
//   - User-facing artwork names show both the artist and artwork title when available.
//   - When only a filename exists, remove folders, URL parts, file extension, and leading catalog ids.
//   - For filenames shaped like id_Author Name - Artwork Title.ext, show Author Name - Artwork Title.
//   - If no structured label can be inferred, show a cleaned basename instead of the raw filename.

const LEADING_ID_PATTERN =
  /^(?:(?:[a-f0-9]{12,24})|(?:\d{3,})|(?:image|archive|painting|file)[-_ ]*\d*)[-_ ]+/i;
const UNKNOWN_NAME_PATTERN =
  /^(?:unknown|unknown artist|unknown artwork|unidentified|unattributed|n\/a)$/i;

export function getBasename(value) {
  if (!value) return "";
  const clean = String(value).split("?")[0].split("#")[0];
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    decoded = clean;
  }
  return decoded.split(/[\\/]/).pop() || decoded;
}

export function stripExtension(value) {
  return String(value || "").replace(/\.[^.]+$/, "");
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseFallback(value) {
  return normalizeWhitespace(value).replace(/\b[a-z]/g, (letter) =>
    letter.toUpperCase(),
  );
}

function getMetadata(record) {
  return record?.metadata || record?.features?.meta || {};
}

function splitArtistTitle(value) {
  const cleanName = cleanArtworkFilename(value);
  const parts = cleanName
    .split(/\s+-\s+|\s+--\s+|\s+\u2013\s+|\s+\u2014\s+/)
    .map(normalizeWhitespace)
    .filter(Boolean);
  return {
    artist: parts.length > 1 ? parts[0] : cleanName.replace(/-/g, " "),
    title: parts.length > 1 ? parts.slice(1).join(" - ") : "",
    cleanName,
  };
}

export function cleanArtworkFilename(value) {
  const withoutExtension = stripExtension(getBasename(value));
  return normalizeWhitespace(withoutExtension.replace(LEADING_ID_PATTERN, ""));
}

export function inferArtistFromFilename(value) {
  const { artist } = splitArtistTitle(value);
  return normalizeWhitespace(artist);
}

export function inferTitleFromFilename(value) {
  const { title } = splitArtistTitle(value);
  return normalizeWhitespace(title);
}

export function needsLogbookClassification(record) {
  const filename =
    record?.filename ||
    record?.fileName ||
    record?.name ||
    record?.path ||
    "";
  const { artist, title } = splitArtistTitle(filename);

  return (
    !artist ||
    !title ||
    UNKNOWN_NAME_PATTERN.test(artist) ||
    UNKNOWN_NAME_PATTERN.test(title)
  );
}

export function getArtworkArtistName(record, fallback = "Unknown artist") {
  const metadata = getMetadata(record);
  const explicitArtist = metadata.artist || record?.artist || record?.author;
  if (explicitArtist) {
    return normalizeWhitespace(explicitArtist);
  }

  const artist = inferArtistFromFilename(
    record?.filename ||
      record?.fileName ||
      record?.name ||
      record?.title ||
      record?.path ||
      fallback,
  );

  return titleCaseFallback(artist || fallback);
}

export function getArtworkTitleName(record, fallback = "Untitled painting") {
  const metadata = getMetadata(record);
  const filename =
    record?.filename ||
    record?.fileName ||
    record?.name ||
    record?.title ||
    record?.path ||
    fallback;
  const inferredTitle = inferTitleFromFilename(filename);
  const explicitTitle =
    metadata.title ||
    record?.artworkTitle ||
    record?.artwork_name ||
    record?.workTitle ||
    (!inferredTitle ? record?.title : "");
  const title = explicitTitle || inferredTitle;

  if (title) {
    return normalizeWhitespace(title);
  }

  return titleCaseFallback(cleanArtworkFilename(filename) || fallback);
}

export function getArtworkDisplayName(record, fallback = "Untitled painting") {
  const artist = getArtworkArtistName(record, "");
  const title = getArtworkTitleName(record, "");
  const normalizedArtist = normalizeWhitespace(artist);
  const normalizedTitle = normalizeWhitespace(title);

  if (
    normalizedArtist &&
    normalizedTitle &&
    normalizedArtist.toLowerCase() !== normalizedTitle.toLowerCase()
  ) {
    return `${normalizedArtist} - ${normalizedTitle}`;
  }

  if (normalizedTitle) return normalizedTitle;
  if (normalizedArtist) return normalizedArtist;

  return titleCaseFallback(
    cleanArtworkFilename(
      record?.filename ||
        record?.fileName ||
        record?.name ||
        record?.title ||
        record?.path ||
        fallback,
    ) || fallback,
  );
}

export function getArtworkSearchText(record, fallback = "") {
  const metadata = record?.metadata || record?.features?.meta || {};
  return [
    record?.filename,
    record?.fileName,
    record?.name,
    record?.title,
    record?.path,
    metadata.title,
    metadata.caption,
    metadata.artist,
    record?.artist,
    record?.author,
    ...(Array.isArray(record?.tags) ? record.tags : []),
    fallback,
  ]
    .filter(Boolean)
    .join(" ");
}
