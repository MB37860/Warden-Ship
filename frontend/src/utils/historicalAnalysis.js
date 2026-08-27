import {
  getArtworkArtistName,
  getArtworkDisplayName,
} from "./artworkNames";

// A date read from a catalogue, a filename or the WikiArt table is a fact.
// Everything else — the artist-lifetime midpoint and the trained year head — is
// a guess, and is drawn in this colour everywhere so it is never mistaken for one.
export const ESTIMATED_YEAR_COLOR = "#ff9d3c";
export const ESTIMATED_YEAR_NOTE = "estimated year — no catalogue date found";
export const UNDATED_NOTE = "undated — no date could be established";

const EXACT_YEAR_SOURCES = new Set(["metadata", "filename", "wikiart"]);

export function isEstimatedYear(yearSource) {
  return !EXACT_YEAR_SOURCES.has(String(yearSource || ""));
}

// The year head is a 73-bin decade classifier trained against Gaussian-smoothed
// targets (sigma 1.5 bins), so even a perfect prediction peaks at about 0.27.
// Printing that raw would read as "27% sure" when it is in fact the ceiling, so
// the peak is reported as a share of what the model can ever assert.
const YEAR_HEAD_PEAK_CEILING = 0.27;

export function yearCertaintyBand(confidence) {
  const peak = Number(confidence);
  if (!Number.isFinite(peak) || peak <= 0) return null;
  const share = peak / YEAR_HEAD_PEAK_CEILING;
  if (share >= 0.66) return "high";
  if (share >= 0.4) return "moderate";
  return "low";
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function scaleValues(records, readValue) {
  const values = records.map((record) => Number(readValue(record)) || 0);
  const lowest = Math.min(...values, 0);
  const highest = Math.max(...values, 0);
  const range = highest - lowest;

  return new Map(records.map((record, index) => [
    record.id,
    range > 0 ? (values[index] - lowest) / range : 0.5,
  ]));
}

function numericYear(value) {
  const year = Number(value);
  return Number.isFinite(year) && year > 0 ? year : null;
}

export function normalizeHistoricalNodes(coords = []) {
  return (Array.isArray(coords) ? coords : [])
    .filter((coord) => coord && coord.x != null && coord.y != null && numericYear(coord.year) != null)
    .map((coord, index) => {
      const year = numericYear(coord.year);
      return {
        id: String(coord.id || coord.file_id || `historic-${index}`),
        artist: coord.artist || getArtworkArtistName(coord, "Unknown artist"),
        title: getArtworkDisplayName(coord, `Painting ${index + 1}`),
        year,
        dateLabel: coord.date_label || String(year),
        estimated: isEstimatedYear(coord.year_source),
        thumb: coord.thumb || coord.image_url || "",
        color: coord.cluster_color || "#c9954f",
        cluster: coord.cluster_label || "Open route",
        projectedY: clamp((Number(coord.y) + 1) / 2),
        bridge: clamp(coord.bridge_score),
        distinctiveness: clamp(coord.distinctiveness),
        visual: coord.visual || {},
        axes: coord.axes || {},
        neighbors: Array.isArray(coord.neighbors) ? coord.neighbors : [],
      };
    })
    .sort((left, right) => left.year - right.year);
}

function colorNovelty(node, averages) {
  const visual = node.visual;
  return (
    Math.abs((Number(visual.warmth) || 0) - averages.warmth) * 1.8 +
    Math.abs((Number(visual.saturation) || 0) - averages.saturation) +
    Math.abs((Number(visual.brightness) || 0) - averages.brightness)
  );
}

function compositionNovelty(node, averages) {
  return (
    Math.abs((Number(node.axes.planar_recession) || 0) - averages.planar) +
    Math.abs((Number(node.axes.linear_painterly) || 0) - averages.painterly)
  );
}

function computeLaterInfluence(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const laterInfluence = new Map(nodes.map((node) => [node.id, 0]));

  nodes.forEach((newer) => {
    newer.neighbors.forEach((neighbor) => {
      const earlier = byId.get(String(neighbor.id));
      if (!earlier || earlier.year >= newer.year) return;
      const similarity = clamp(neighbor.similarity);
      laterInfluence.set(earlier.id, laterInfluence.get(earlier.id) + similarity);
    });
  });

  return laterInfluence;
}

export function buildCreativityReadings(nodes, beta = 0.56, dimension = "overall") {
  if (!nodes.length) return [];

  const averages = {
    warmth: mean(nodes.map((node) => Number(node.visual.warmth) || 0)),
    saturation: mean(nodes.map((node) => Number(node.visual.saturation) || 0)),
    brightness: mean(nodes.map((node) => Number(node.visual.brightness) || 0)),
    planar: mean(nodes.map((node) => Number(node.axes.planar_recession) || 0)),
    painterly: mean(nodes.map((node) => Number(node.axes.linear_painterly) || 0)),
  };
  const originalityRaw = (node) => {
    if (dimension === "color") return colorNovelty(node, averages);
    if (dimension === "composition") return compositionNovelty(node, averages);
    if (dimension === "subject") return node.bridge;
    return node.distinctiveness * 0.62 + node.bridge * 0.38;
  };
  const influenceRaw = computeLaterInfluence(nodes);
  const originality = scaleValues(nodes, originalityRaw);
  const influence = scaleValues(nodes, (node) => influenceRaw.get(node.id));
  const balance = clamp(beta);

  return nodes.map((node) => {
    const original = originality.get(node.id) || 0;
    const influential = influence.get(node.id) || 0;
    return {
      ...node,
      originality: original,
      influence: influential,
      creativity: balance * original + (1 - balance) * influential,
    };
  });
}

export function buildInfluenceNetwork(nodes, focusArtist = "") {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const linksByKey = new Map();

  nodes.forEach((newer) => {
    newer.neighbors.forEach((neighbor) => {
      const earlier = byId.get(String(neighbor.id));
      if (
        !earlier ||
        earlier.year >= newer.year ||
        earlier.artist === newer.artist
      ) {
        return;
      }

      const key = `${earlier.artist}->${newer.artist}`;
      const similarity = clamp(neighbor.similarity);
      if (similarity <= 0) return;
      const current = linksByKey.get(key);
      if (!current) {
        linksByKey.set(key, {
          id: key,
          from: earlier.artist,
          to: newer.artist,
          firstYear: earlier.year,
          lastYear: newer.year,
          weight: similarity,
          count: 1,
          evidence: { earlier, newer, similarity },
        });
        return;
      }

      current.weight += similarity;
      current.count += 1;
      current.firstYear = Math.min(current.firstYear, earlier.year);
      current.lastYear = Math.max(current.lastYear, newer.year);
      if (similarity > current.evidence.similarity) {
        current.evidence = { earlier, newer, similarity };
      }
    });
  });

  let links = Array.from(linksByKey.values())
    .sort((left, right) => right.weight - left.weight);
  if (focusArtist) {
    links = links.filter(
      (link) => link.from === focusArtist || link.to === focusArtist,
    );
  }
  links = links.slice(0, focusArtist ? 22 : 16);

  const visibleArtists = new Set(
    links.flatMap((link) => [link.from, link.to]),
  );
  const artistsByName = new Map();
  nodes.forEach((node) => {
    if (!visibleArtists.has(node.artist)) return;
    const current = artistsByName.get(node.artist) || {
      id: node.artist,
      name: node.artist,
      yearTotal: 0,
      projectedTotal: 0,
      works: 0,
      color: node.color,
      thumb: node.thumb,
    };
    current.yearTotal += node.year;
    current.projectedTotal += node.projectedY;
    current.works += 1;
    artistsByName.set(node.artist, current);
  });

  const artists = Array.from(artistsByName.values()).map((artist) => ({
    ...artist,
    year: Math.round(artist.yearTotal / artist.works),
    projectedY: artist.projectedTotal / artist.works,
  }));
  const maxWeight = Math.max(...links.map((link) => link.weight), 1);

  return {
    artists,
    links: links.map((link) => ({
      ...link,
      strength: link.weight / maxWeight,
    })),
  };
}
