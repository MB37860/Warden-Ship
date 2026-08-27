const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const DEFAULT_MIN_STAR_SEPARATION = 4.8;

function hashValue(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededUnit(seed, index) {
  const x = Math.sin(hashValue(`${seed}:${index}`) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// The sky is a disc. A silhouette boundary scaled every star's radius by the
// shape's edge distance, so the one thing the map encodes — how well a work
// matches the query — was being distorted by a decorative choice, and each
// shape also capped the view at anywhere from 16 to 98 stars.
const SKY_CENTRE = { x: 50, y: 50 };
const SKY_RADIUS = 45;

// The query word sits at the centre, so the innermost ring starts outside it:
// the best match belongs beside the word, not on top of it. The keep-out is a
// circle in the same space as the sky rather than an ellipse hugging the text,
// so the gap between it and the rim is the same on every bearing — otherwise
// the rank-to-distance mapping changes with direction and the top match can end
// up further from the centre than a weaker one.
const CENTRE_KEEP_OUT = 12;
const INNER_ORBIT = CENTRE_KEEP_OUT * 1.06;

// Successive ranks are placed a golden angle apart, the way seeds sit in a
// sunflower head: neighbouring ranks never line up, and the disc fills evenly
// without anyone having to invent a meaning for the bearing. The angle carries
// nothing and is not presented as if it did — only the radius is a measurement.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * How many stars stay individually readable, measured in on-screen terms.
 *
 * The disc covers the whole window, so its height in pixels is only `aspect` of
 * its width; the usable area is that much smaller, and the centre word's
 * keep-out is not usable at all. Counting the naive circle let the slider offer
 * 100 stars for a space that holds about two thirds of that, which is why the
 * map turned into a single glow.
 */
export function estimateSkyCapacity(
  aspect = 9 / 16,
  minSeparation = DEFAULT_MIN_STAR_SEPARATION,
) {
  const disc = Math.PI * SKY_RADIUS * SKY_RADIUS * aspect;
  const centreWord = Math.PI * INNER_ORBIT * INNER_ORBIT * aspect;
  const usable = Math.max(disc - centreWord, 0);
  return clamp(Math.floor(usable / (minSeparation * minSeparation * 2.25)), 8, 160);
}

/**
 * Place stars so that distance from the centre is how well the work matches the
 * query: the strongest match sits on the centre word, the weakest on the rim.
 *
 * The radius comes from each work's **rank within this result set**, not from
 * its raw score. CLIP cosine similarities sit in a very narrow absolute band —
 * a whole result set typically spans about 0.06 — so feeding the raw number to
 * the radius put every star in the same thin ring whatever you searched for.
 * Ranking spends the full radius on whatever spread the query actually produced.
 */
export function fitStarsToSky({ images, query, maxStars = 120, aspect = 9 / 16 }) {
  const minSeparation = DEFAULT_MIN_STAR_SEPARATION;
  const capacity = estimateSkyCapacity(minSeparation);
  const source = images.slice(0, Math.min(maxStars, images.length, capacity));
  const seed = `sky:${query || "constellation"}`;
  const placed = [];

  const entries = source
    .map((image, sourceIndex) => ({
      image,
      sourceIndex,
      relevance: clamp(image.relevanceScore ?? image.score ?? 0, 0, 1),
    }))
    .sort((a, b) => b.relevance - a.relevance);

  const lastRank = Math.max(entries.length - 1, 1);

  entries.forEach(({ image, sourceIndex, relevance }, rank) => {
    // Slightly less than linear, so the handful of strongest matches cluster
    // tightly on the centre word instead of spreading out immediately.
    const position = entries.length <= 1 ? 0 : rank / lastRank;
    const orbitRatio = clamp(0.05 + position ** 0.85 * 0.93, 0.03, 0.99);
    const baseAngle = rank * GOLDEN_ANGLE;
    const angleSeed = `${image.id || image.filename || image.name}:${sourceIndex}`;
    let best = null;

    for (let attempt = 0; attempt < 48; attempt += 1) {
      // Widen the search around the seeded bearing until the star has room.
      const drift = attempt * 0.11 * (attempt % 2 === 0 ? 1 : -1);
      const angle = baseAngle + drift;
      const orbitJitter = (seededUnit(seed, `${angleSeed}:r:${attempt}`) - 0.5) * 0.04;
      // Ring 0 sits just clear of the centre word and the rim is the outer
      // edge, so the whole usable band is spent on the ranking.
      const radius = INNER_ORBIT + clamp(orbitRatio + orbitJitter, 0, 1) * (SKY_RADIUS - INNER_ORBIT);
      const x = clamp(SKY_CENTRE.x + Math.cos(angle) * radius, 3, 97);
      const y = clamp(SKY_CENTRE.y + Math.sin(angle) * radius, 3, 97);
      // The map is drawn across the full window, so one unit of y is fewer
      // pixels than one unit of x. Measuring separation without that correction
      // let stars that were comfortably apart in the maths land on top of each
      // other on screen, which is what made the sky read as a single haze.
      const nearestDistance = placed.reduce(
        (nearest, star) =>
          Math.min(nearest, Math.hypot(star.x - x, (star.y - y) * aspect)),
        Infinity,
      );
      // Keep the ring the rank earned; only the bearing is free to move.
      const candidateScore = nearestDistance - Math.abs(orbitJitter) * 30;

      if (!best || candidateScore > best.candidateScore) {
        best = { x, y, radius, candidateScore, nearestDistance };
      }
      if (nearestDistance >= minSeparation) break;
    }

    if (!best || best.nearestDistance < minSeparation * 0.62) return;

    placed.push({
      image,
      x: best.x,
      y: best.y,
      distance: clamp(best.radius / SKY_RADIUS, 0, 1),
      radialLight: relevance,
      relevance,
      rank,
    });
  });

  return placed.sort((a, b) => b.relevance - a.relevance);
}

export function buildProximityLinks(
  stars,
  { neighbors = 1, threshold = 18 } = {},
) {
  if (stars.length < 2) {
    return [];
  }

  const linkMap = new Map();
  const addLink = (from, to, distance) => {
    const key = [from.id, to.id].sort().join(":");
    if (!linkMap.has(key)) {
      linkMap.set(key, {
        id: key,
        from,
        to,
        opacity: clamp(0.58 - distance / threshold / 2, 0.18, 0.58),
      });
    }
  };

  const connected = [stars[0]];
  const remaining = stars.slice(1);

  while (remaining.length > 0) {
    let best = null;
    connected.forEach((from) => {
      remaining.forEach((to, index) => {
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        if (!best || distance < best.distance) {
          best = { from, to, index, distance };
        }
      });
    });

    addLink(best.from, best.to, best.distance);
    connected.push(best.to);
    remaining.splice(best.index, 1);
  }

  stars.forEach((star) => {
    const nearest = stars
      .filter((candidate) => candidate.id !== star.id)
      .map((candidate) => ({
        star: candidate,
        distance: Math.hypot(candidate.x - star.x, candidate.y - star.y),
      }))
      .filter((candidate) => candidate.distance <= threshold)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, neighbors);

    nearest.forEach(({ star: to, distance }) => {
      addLink(star, to, distance);
    });
  });

  return Array.from(linkMap.values());
}
