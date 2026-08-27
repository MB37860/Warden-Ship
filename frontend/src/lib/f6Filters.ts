import {
  COMPASS_SECTORS,
  POSE_PRESETS,
  FEATURE_NAMES,
  LIGHTNESS_LEVELS,
  SATURATION_LEVELS,
  SWATCHES,
} from "./f6Constants";
import {
  getArtworkArtistName,
  getArtworkDisplayName,
  getArtworkTitleName,
} from "../utils/artworkNames";

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function titleCase(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

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

export function normalizeKey(value) {
  return getBasename(value).toLowerCase();
}

function buildImageLookup(images) {
  const lookup = new Map();
  images.forEach((image) => {
    [
      image?.id,
      image?.fileId,
      image?._id,
      image?.filename,
      image?.fileName,
      image?.name,
      normalizeKey(image?.filename),
      normalizeKey(image?.fileName),
      normalizeKey(image?.imageUrl),
    ]
      .filter(Boolean)
      .forEach((key) => lookup.set(String(key).toLowerCase(), image));
  });
  return lookup;
}

function findImageForRecord(record, lookup) {
  const meta = record?.features?.meta || {};
  const keys = [
    record?.id,
    record?.path,
    record?.filename,
    record?.file_id,
    meta.id,
    meta.file_id,
    meta.filename,
    normalizeKey(record?.id),
    normalizeKey(record?.path),
    normalizeKey(record?.filename),
  ];
  for (const key of keys) {
    if (!key) continue;
    const image = lookup.get(String(key).toLowerCase());
    if (image) return image;
  }
  return null;
}

export function normalizeRecords(indexRecords = [], images = []) {
  const records = Array.isArray(indexRecords)
    ? indexRecords
    : indexRecords && typeof indexRecords === "object"
      ? Object.entries(indexRecords).map(([id, value]) => ({ id, ...(value && typeof value === "object" ? value : { value }) }))
      : [];
  const lookup = buildImageLookup(images);
  return records.map((record, index) => {
    const image = findImageForRecord(record, lookup);
    const fallbackName = record?.path || record?.id || `painting-${index + 1}`;
    const meta = record?.features?.meta || {};
    const sourceRecord = image || record;
    return {
      key: record?.id || fallbackName || `painting-${index + 1}`,
      id: record?.id || getBasename(fallbackName) || `painting-${index + 1}`,
      title: getArtworkTitleName(sourceRecord, fallbackName),
      displayName: getArtworkDisplayName(sourceRecord, fallbackName),
      artist:
        getArtworkArtistName(
          { ...(image || {}), artist: image?.artist || meta.artist },
          fallbackName,
        ) ||
        "Unknown artist",
      year: image?.metadata?.year || image?.year || meta.year || null,
      movement:
        image?.metadata?.movement ||
        image?.movement ||
        meta.movement ||
        "Uncatalogued",
      origin:
        image?.metadata?.region ||
        image?.metadata?.origin ||
        image?.region ||
        image?.origin ||
        meta.region ||
        meta.origin ||
        null,
      imageUrl:
        image?.imageUrl ||
        image?.image_url ||
        record?.image_url ||
        record?.thumbnail ||
        record?.thumb ||
        meta.image_url ||
        meta.thumbnail ||
        null,
      raw: record,
    };
  });
}

export function featureOf(record, key) {
  const features = record?.raw?.features || record?.features || {};
  const aliases = {
    color: ["color", "colors"],
    pose: ["pose", "poses", "body_pose"],
    portrait_pose: ["portrait_pose", "portrait_poses", "portraitPose", "face_pose"],
    hough: ["hough", "edges", "lines"],
  }[key] || [key];
  for (const alias of aliases) {
    if (features?.[alias]) return features[alias];
    if (record?.raw?.[alias]) return record.raw[alias];
    if (record?.[alias]) return record[alias];
  }
  return null;
}

function normaliseHsl(h, s, l) {
  if (![h, s, l].every(Number.isFinite)) return null;
  return [h > 1 ? h / 360 : h, s > 1 ? s / 100 : s, l > 1 ? l / 100 : l];
}

export function getColorHsl(record) {
  const color = featureOf(record, "color") || {};
  const source = color.dominant_hsl || color.dominantHsl || color.hsl || color.dominant_color_hsl;
  if (Array.isArray(source)) {
    return normaliseHsl(Number(source[0]), Number(source[1]), Number(source[2]));
  }
  if (source && typeof source === "object") {
    return normaliseHsl(
      Number(source.h ?? source.hue),
      Number(source.s ?? source.saturation),
      Number(source.l ?? source.lightness),
    );
  }
  return null;
}

// A painting is rarely one colour. The pipeline already clusters it into five,
// each with the share of canvas it covers, so a gold-ochre wall with a deep blue
// robe can hang on both dyes instead of only on the larger one. The cut is on
// coverage, not on rank: k-means always returns five centres, and without it a
// two-percent speck would claim a dye as loudly as half the canvas — which is
// what made neighbouring swatches hand back the same paintings before.
// Measured on the 100-painting mixed set: 0.12 gives 1.7 dyes per painting and
// leaves 9 of 100 on no dye at all, against 2.4 and 3 with no cut.
const PALETTE_MIN_WEIGHT = 0.12;

export function getColorPalette(record) {
  const color = featureOf(record, "color") || {};
  const entries = color.palette_hsl || color.paletteHsl;
  const weights = color.palette_weights || color.paletteWeights;
  // Collections analysed before the pipeline stored cluster shares. Such a
  // palette cannot tell a wall from a speck, so every cluster in it counts:
  // loose, but dyes are ANDed, and filing those paintings under the dominant
  // colour alone would give each of them exactly one dye and make every
  // two-cloth search on an old collection return nothing at all. Measured on
  // the 100-painting mixed set: 2.4 dyes per painting instead of 0.7, and 5
  // paintings on no dye instead of 28.
  if (!Array.isArray(entries)) {
    const dominant = getColorHsl(record);
    return dominant ? [{ hsl: dominant, weight: 1 }] : [];
  }
  if (!Array.isArray(weights) || weights.length !== entries.length) {
    return entries
      .map((entry) => (Array.isArray(entry) ? normaliseHsl(Number(entry[0]), Number(entry[1]), Number(entry[2])) : null))
      .filter(Boolean)
      .map((hsl) => ({ hsl, weight: 1 }));
  }
  return entries
    .map((entry, index) => {
      const hsl = Array.isArray(entry)
        ? normaliseHsl(Number(entry[0]), Number(entry[1]), Number(entry[2]))
        : null;
      const weight = Number(weights[index]);
      return hsl && Number.isFinite(weight) ? { hsl, weight } : null;
    })
    .filter(Boolean);
}

/** Every dye the painting carries enough of to be filed under. */
export function dyesForRecord(record) {
  const dyes = new Set();
  getColorPalette(record).forEach(({ hsl, weight }) => {
    if (weight < PALETTE_MIN_WEIGHT) return;
    const dye = nearestSwatchHue(hsl);
    if (dye != null) dyes.add(dye);
  });
  return dyes;
}

// Saturation and lightness only mean anything against the collection they were
// measured in. Absolute cutoffs of 0.35 and 0.65 put 77 of the 100-painting
// mixed set in "muted" and 7 in "vivid" — its median dominant saturation is
// 0.21, so two thirds of the slider returned almost nothing. Each band now
// takes a third of the range the collection actually spans, the same way the
// line directions above are cut. The absolute numbers stay as the fallback for
// a collection too small or too uniform to rank.
const ABSOLUTE_BAND_CUTOFFS = [0.35, 0.65];
const BAND_FRACTION = 1 / 3;

function bandFor(value, cutoffs, levels) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const [low, high] = cutoffs || ABSOLUTE_BAND_CUTOFFS;
  if (number < low) return levels[0];
  if (number < high) return levels[1];
  return levels[2];
}

function tercileCutoffs(values) {
  if (values.length < 3) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  // The cutoff is the first value of the band above it, so each band holds a
  // third of the collection rather than a third of its numeric range.
  const at = (fraction) => sorted[clamp(Math.floor(fraction * sorted.length), 0, sorted.length - 1)];
  const low = at(BAND_FRACTION);
  const high = at(1 - BAND_FRACTION);
  return low < high ? [low, high] : null;
}

export function buildColorStats(records) {
  const saturations = [];
  const lightnesses = [];
  records.forEach((record) => {
    const hsl = getColorHsl(record);
    if (!hsl) return;
    saturations.push(hsl[1]);
    lightnesses.push(hsl[2]);
  });
  return {
    saturationCutoffs: tercileCutoffs(saturations),
    lightnessCutoffs: tercileCutoffs(lightnesses),
  };
}

export function getSaturationBand(value, stats) {
  return bandFor(value, stats?.saturationCutoffs, SATURATION_LEVELS);
}

export function getLightnessBand(value, stats) {
  return bandFor(value, stats?.lightnessCutoffs, LIGHTNESS_LEVELS);
}

export function hueDistance(a, b) {
  const distance = Math.abs(Number(a) - Number(b));
  return Math.min(distance, 1 - distance);
}

/** The dye's own name when the hue is one of the swatches, its colour band otherwise. */
export function dyeName(hue) {
  const swatch = SWATCHES.find(([, , swatchHue]) => swatchHue === hue);
  return swatch ? swatch[0] : hueName(hue);
}

export function hueName(hue) {
  if (hue == null) return "Any hue";
  const family = nearestSwatchHue([Number(hue), 1, 0.5]);
  return SWATCHES.find(([, , swatchHue]) => swatchHue === family)?.[0] || "Any hue";
}

// Boundaries in degrees of yaw, chosen so each sector keeps its plain meaning
// (frontal is frontal in any collection) while all five stay populated: on the
// 100-image test set they hold 5 / 5 / 18 / 7 / 7 of the 42 detected faces.
// The carved head and the filter both read sectors through this one function,
// so what the puppet shows and what the filter selects cannot drift apart —
// previously the head called "E" at yaw > 34 while the matcher wanted yaw > 45.
export function getHoughMedium(record) {
  const hough = featureOf(record, "hough");
  if (!hough) return null;
  const medium = hough.medium || hough.presets?.medium || hough;
  return {
    ...medium,
    line_count: medium.line_count ?? medium.lineCount ?? medium.lines_count ?? medium.count,
    rho_theta_hist: medium.rho_theta_hist ?? medium.rhoThetaHist ?? medium.theta_hist ?? medium.histogram,
  };
}

export const LINE_DIRECTIONS = ["vertical", "diagonal", "horizontal"];

// The backend stores a flattened 32x32 histogram over (rho, theta): rho is the
// row, theta the column, so entry i belongs to theta bin i % 32. The old code
// read i / 1024 as an angle, which is mostly the rho axis — it was classifying
// where lines sit in the frame, not which way they point.
const THETA_BINS = 32;

// OpenCV's theta is the angle of the line's normal: theta = 0 is a vertical
// line, theta = 90 a horizontal one. Three equal 60-degree bands, so no class
// gets a wider net than the others (diagonal used to get twice the width).
function bandForTheta(degrees) {
  if (degrees < 30 || degrees >= 150) return "vertical";
  if (degrees >= 60 && degrees < 120) return "horizontal";
  return "diagonal";
}

/** Share of a painting's detected edge energy falling in each direction band. */
export function getDirectionShares(histogram) {
  if (!Array.isArray(histogram) || histogram.length < THETA_BINS) return null;
  const totals = { vertical: 0, horizontal: 0, diagonal: 0 };
  let sum = 0;
  histogram.forEach((value, index) => {
    const amount = Math.max(0, Number(value) || 0);
    const theta = (((index % THETA_BINS) + 0.5) / THETA_BINS) * 180;
    totals[bandForTheta(theta)] += amount;
    sum += amount;
  });
  if (!sum) return null;
  return {
    vertical: totals.vertical / sum,
    horizontal: totals.horizontal / sum,
    diagonal: totals.diagonal / sum,
  };
}

// A painting is "vertical" only relative to the collection it sits in. Measured
// on the 100-image test set the median painting scores 0.32 / 0.31 / 0.36 across
// the three bands — no preferred direction at all — so an absolute rule labels
// two thirds of any collection "mixed" and the tiles stop responding. Each
// direction instead selects the third of the collection most committed to it.
// The floor keeps that honest: a share of 1/3 is what a painting with no
// preferred direction shows, so a collection containing nothing vertical
// returns nothing rather than its least-horizontal third.
const DIRECTION_SHARE_FLOOR = 1 / 3;
const DIRECTION_SELECTED_FRACTION = 1 / 3;

export function buildLineStats(records) {
  const counts = [];
  const shares = { vertical: [], horizontal: [], diagonal: [] };

  records.forEach((record) => {
    const medium = getHoughMedium(record);
    const count = Number(medium?.line_count);
    if (Number.isFinite(count)) counts.push(count);
    const painting = getDirectionShares(medium?.rho_theta_hist);
    if (painting) LINE_DIRECTIONS.forEach((direction) => shares[direction].push(painting[direction]));
  });

  const directionCutoffs = {};
  LINE_DIRECTIONS.forEach((direction) => {
    const ranked = shares[direction].slice().sort((a, b) => b - a);
    const index = Math.max(0, Math.ceil(ranked.length * DIRECTION_SELECTED_FRACTION) - 1);
    directionCutoffs[direction] = ranked.length
      ? Math.max(ranked[index], DIRECTION_SHARE_FLOOR)
      : DIRECTION_SHARE_FLOOR;
  });

  return { counts: counts.sort((a, b) => a - b), directionCutoffs };
}

export function matchesDirection(record, direction, stats) {
  const shares = getDirectionShares(getHoughMedium(record)?.rho_theta_hist);
  const cutoff = stats?.directionCutoffs?.[direction];
  if (!shares || cutoff == null) return false;
  return shares[direction] >= cutoff;
}

export function getIntensityScore(lineCount, stats) {
  const count = Number(lineCount);
  if (!Number.isFinite(count) || !stats.counts.length) return null;
  const rank = stats.counts.findIndex((entry) => entry >= count);
  const safeRank = rank === -1 ? stats.counts.length - 1 : rank;
  if (stats.counts.length === 1) return 5;
  return clamp(Math.round((safeRank / (stats.counts.length - 1)) * 10), 0, 10);
}

export function getIntensityName(score) {
  if (score == null) return "Any";
  if (score <= 3) return "Few lines";
  if (score <= 6) return "Some lines";
  return "Many lines";
}

export function houghDensityBucket(score) {
  if (score == null) return null;
  if (score <= 3) return "few";
  if (score <= 6) return "some";
  return "many";
}

// Hue is undefined for a grey pixel, and HSL reports it as 0 — which is exactly
// where the red family sits. Engravings, pencil drawings and black-and-white
// photographs were therefore all filed under red: five of its eight members had
// saturation below 0.034. Below this cut a colour has no hue worth naming and
// joins no family at all.
const MIN_HUE_SATURATION = 0.12;

// The families divide the hue circle between them, so a colour saturated enough
// to have a hue always lands in one. An earlier board of twelve narrow dyes
// capped this at 0.04 and left 28 of 100 paintings reachable from no dye —
// nothing named the greens between olive and forest. Six families are wide
// enough that a cap would only recreate those holes.
function nearestSwatchHue(hsl) {
  if (!hsl || hsl[1] < MIN_HUE_SATURATION) return null;
  let best = null;
  let bestDistance = Infinity;
  SWATCHES.forEach(([, , swatchHue]) => {
    const distance = hueDistance(hsl[0], swatchHue);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = swatchHue;
    }
  });
  return best;
}

// Boundaries in degrees of yaw, set from how a painted face actually reads
// rather than by dividing the range evenly. A head turned 13 degrees still looks
// like it is facing you, so a +-12 frontal band pushed plainly frontal portraits
// into the three-quarter sectors — that was where nearly all the wrong answers
// came from. Frontal is +-18; a profile starts at 32.
//
// The carved head and the filter both read sectors through sectorForYaw below,
// so what the puppet shows and what the filter selects cannot drift apart.
const SECTOR_YAW_LIMITS = [
  ["W", -32],
  ["NW", -18],
  ["N", 18],
  ["NE", 32],
];

// portrait_pose.py emits degrees from every backend. An earlier version guessed
// the unit here — anything within +-2*pi was assumed to be radians and scaled by
// 180/pi — which threw every face within 6.3 degrees of frontal into a side
// sector. Frontal portraits are the commonest case, so the guess was wrong
// exactly where it mattered most. Degrees, no guessing.
export function sectorForYaw(yawValue) {
  const yaw = Number(yawValue);
  if (!Number.isFinite(yaw)) return null;
  const band = SECTOR_YAW_LIMITS.find(([id, limit]) => (id === "W" ? yaw <= limit : yaw < limit));
  return band ? band[0] : "E";
}

/** Middle of a sector, for posing the carved head when a sector is selected. */
export function yawForSector(sector) {
  if (sector === "W") return -46;
  if (sector === "NW") return -25;
  if (sector === "NE") return 25;
  if (sector === "E") return 46;
  return 0;
}

export function getPoseFeature(record) {
  return featureOf(record, "pose") || {};
}

// MediaPipe always emits all 33 joints, extrapolating the ones it cannot see —
// for a bust-length portrait it invents a pair of legs below the frame. Measured
// on the test set the median visibility is 1.00 for shoulders but 0.15 for knees
// and 0.05 for ankles, so any rule that reads a leg is reading fiction unless it
// checks first.
const MIN_JOINT_VISIBILITY = 0.5;

function getKeypoint(pose, index) {
  const point = pose?.keypoints?.[index];
  if (!point) return null;
  if (Array.isArray(point)) {
    return {
      x: Number(point[0]),
      y: Number(point[1]),
      visibility: Number(point[2] ?? point[3] ?? 1),
    };
  }
  return {
    x: Number(point.x),
    y: Number(point.y),
    visibility: Number(point.visibility ?? point.score ?? 1),
  };
}

/** The joint, or null when the model did not actually see it. */
function seenKeypoint(pose, index) {
  const point = getKeypoint(pose, index);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return point.visibility >= MIN_JOINT_VISIBILITY ? point : null;
}

function averagePoint(points, axis) {
  const values = points
    .filter((point) => point && Number.isFinite(point[axis]) && point.visibility > 0.25)
    .map((point) => point[axis]);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}



/**
 * The one arm position a painting shows, or null when it cannot be read.
 *
 * Exclusive by construction: the eight independent boolean rules this replaces
 * let a single painting answer yes to Standing, Seated and Kneeling at once,
 * which is why picking a different tile kept returning the same pictures.
 */
export function poseLabel(record) {
  const pose = getPoseFeature(record);
  const valid = Boolean(pose?.pose_valid ?? pose?.valid);
  if (!valid) return null;

  const leftShoulder = seenKeypoint(pose, 11);
  const rightShoulder = seenKeypoint(pose, 12);
  const leftWrist = seenKeypoint(pose, 15);
  const rightWrist = seenKeypoint(pose, 16);
  if (!leftShoulder || !rightShoulder) return null;
  // No visible wrist means no claim about the arms, rather than a default.
  if (!leftWrist && !rightWrist) return null;

  const shoulderY = averagePoint([leftShoulder, rightShoulder], "y");
  const wristY = averagePoint([leftWrist, rightWrist], "y");
  if (shoulderY == null || wristY == null) return null;

  // y grows downwards, so a wrist above the shoulder line has the smaller value.
  if (wristY < shoulderY - 0.04) return "armsRaised";

  // Both wrists are needed to measure a span at all. The margin over shoulder
  // width is 1.2 rather than 1.5: measured across the collection the ratio runs
  // 0.18 to 1.62, so 1.5 sat above all but one painting and left the tile empty.
  const shoulderSpread = Math.abs(leftShoulder.x - rightShoulder.x);
  const wristSpread =
    leftWrist && rightWrist ? Math.abs(leftWrist.x - rightWrist.x) : 0;
  if (shoulderSpread > 0 && wristSpread > shoulderSpread * 1.2) return "armsOut";

  return "armsDown";
}

export function matchPosePreset(record, presetId) {
  return poseLabel(record) === presetId;
}

// A pinned cloth is the colour search; the two sliders only qualify it. On
// their own they would cut the collection to a third of itself with nothing on
// the board to say why, so a bandless board counts as the instrument being off.
export function isColorActive(color) {
  return Boolean(color.hues?.length);
}

export function isPortraitActive(portrait) {
  return Boolean(portrait.sector || portrait.portraitsOnly);
}

export function isHoughActive(hough) {
  return hough.intensity != null || hough.directions.length > 0;
}

export function isOriginActive(origin) {
  return Boolean(origin?.region);
}

function recordMatchesColor(record, color, stats) {
  if (!isColorActive(color)) return true;
  if (color.hues?.length) {
    // Pinning a second cloth asks for a painting carrying both dyes, not for
    // either of them: every dye added narrows the search rather than widening
    // it. A dye the collection files under nobody therefore empties the board,
    // which is why the cloths carry the count they would leave.
    const dyes = dyesForRecord(record);
    if (!color.hues.every((hue) => dyes.has(hue))) return false;
  }
  if (color.sat || color.light) {
    // The bands qualify the pinned dye rather than standing alone, and they
    // describe the canvas as a whole, so they read the dominant colour even
    // when the hue that matched came from elsewhere in the palette: "a painting
    // holding teal, dark overall".
    const hsl = getColorHsl(record);
    if (!hsl) return false;
    if (color.sat && getSaturationBand(hsl[1], stats) !== color.sat) return false;
    if (color.light && getLightnessBand(hsl[2], stats) !== color.light) return false;
  }
  return true;
}

function recordMatchesPortrait(record, portrait) {
  if (!isPortraitActive(portrait)) return true;
  const pose = featureOf(record, "portrait_pose") || {};
  if (!(pose.face_found ?? pose.faceFound ?? pose.found ?? pose.valid)) return false;
  if (!portrait.sector) return true;
  return sectorForYaw(pose.yaw ?? pose.yaw_deg ?? pose.rotation_y) === portrait.sector;
}

function recordMatchesHough(record, hough, stats) {
  if (!isHoughActive(hough)) return true;
  const medium = getHoughMedium(record);
  if (!medium) return false;
  if (hough.intensity != null) {
    const score = getIntensityScore(medium.line_count, stats);
    if (houghDensityBucket(score) !== houghDensityBucket(hough.intensity)) return false;
  }
  if (hough.directions.length && !hough.directions.some((direction) => matchesDirection(record, direction, stats))) return false;
  return true;
}

function recordMatchesOrigin(record, origin) {
  if (!isOriginActive(origin)) return true;
  const region = String(record.origin || record.raw?.features?.meta?.region || record.raw?.features?.meta?.origin || "").toLowerCase();
  return region === String(origin.region).toLowerCase();
}

export function filterPaintings(records, filters, stats, ignoredInstrument = null) {
  return records.filter((record) => {
    if (ignoredInstrument !== "color" && !recordMatchesColor(record, filters.color, stats)) return false;
    if (ignoredInstrument !== "portrait" && !recordMatchesPortrait(record, filters.portrait)) return false;
    if (ignoredInstrument !== "pose" && filters.pose && !matchPosePreset(record, filters.pose)) return false;
    if (ignoredInstrument !== "hough" && !recordMatchesHough(record, filters.hough, stats)) return false;
    if (ignoredInstrument !== "origin" && !recordMatchesOrigin(record, filters.origin)) return false;
    return true;
  });
}

export function colorLabel(color) {
  return [
    color.hues?.length ? color.hues.map(dyeName).join(" + ") : hueName(null),
    color.sat ? `${color.sat} pigment` : null,
    color.light ? `${color.light} lamp` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export function buildAvailability(records) {
  return {
    color: records.some((record) => Array.isArray(getColorHsl(record))),
    portrait: records.some((record) => {
      const pose = featureOf(record, "portrait_pose") || {};
      return Boolean(pose.face_found ?? pose.faceFound ?? pose.found ?? pose.valid);
    }),
    pose: records.some((record) => {
      const pose = getPoseFeature(record);
      return Boolean(
        pose?.valid ?? pose?.pose_valid ?? (pose?.cluster_id != null || pose?.cluster != null),
      );
    }),
    hough: records.some((record) => Number.isFinite(Number(getHoughMedium(record)?.line_count))),
  };
}

// How many paintings each individual option would return on its own. The
// instrument-level `buildAvailability` only knows whether a feature has any data
// at all, so a tile like "arms raised" stayed lit while matching nothing: 80 of
// 100 paintings yield no skeleton, and every one of those can never match any
// pose tile. Counting per option lets the board grey out the dead ones instead
// of leaving the user to discover them by clicking.
// Dyes are ANDed, so what a cloth is worth depends on what is already pinned:
// the honest number is how many of the paintings still on the table carry it.
// Counted over the unfiltered collection a cloth would advertise 20 paintings
// and then return none, which is the trap the counts exist to prevent.
export function buildHueCounts(records) {
  const hues = {};
  SWATCHES.forEach(([, , swatchHue]) => {
    hues[swatchHue] = records.filter((record) => dyesForRecord(record).has(swatchHue)).length;
  });
  return hues;
}

export function buildOptionCounts(records, stats) {
  const poses = {};
  POSE_PRESETS.forEach(([id]) => {
    poses[id] = records.filter((record) => matchPosePreset(record, id)).length;
  });

  const sectors = {};
  COMPASS_SECTORS.forEach((sector) => {
    sectors[sector] = records.filter((record) => {
      const pose = featureOf(record, "portrait_pose") || {};
      if (!(pose.face_found ?? pose.faceFound ?? pose.found ?? pose.valid)) return false;
      return sectorForYaw(pose.yaw ?? pose.yaw_deg ?? pose.rotation_y) === sector;
    }).length;
  });


  const directions = {};
  LINE_DIRECTIONS.forEach((direction) => {
    directions[direction] = records.filter((record) => matchesDirection(record, direction, stats)).length;
  });

  return { poses, sectors, hues: buildHueCounts(records), directions };
}
