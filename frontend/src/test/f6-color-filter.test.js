import { describe, expect, it } from "vitest";
import {
  buildColorStats,
  buildHueCounts,
  buildOptionCounts,
  dyesForRecord,
  filterPaintings,
  getSaturationBand,
  isColorActive,
} from "../lib/f6Filters";

const YELLOW = 0.14;
const GREEN = 0.3;
const BLUE = 0.58;

// [hue, saturation, lightness] normalised, as the pipeline writes them.
function painting(id, palette) {
  return {
    id,
    features: {
      color: {
        dominant_hsl: palette[0][0],
        palette_hsl: palette.map(([hsl]) => hsl),
        palette_weights: palette.map(([, weight]) => weight),
      },
    },
  };
}

function colorFilter(value) {
  return {
    color: { hues: [], sat: null, light: null, ...value },
    portrait: { sector: null, portraitsOnly: false },
    pose: null,
    hough: { intensity: null, directions: [] },
    origin: { region: null },
  };
}

describe("dye membership", () => {
  it("files a painting under every dye it carries enough of", () => {
    const record = painting("two-dyes", [
      [[0.15, 0.4, 0.5], 0.55],
      [[0.56, 0.5, 0.4], 0.45],
    ]);
    expect([...dyesForRecord(record)].sort()).toEqual([YELLOW, BLUE]);
  });

  it("ignores a colour that covers too little of the canvas", () => {
    const record = painting("speck", [
      [[0.15, 0.4, 0.5], 0.94],
      [[0.56, 0.5, 0.4], 0.06],
    ]);
    expect([...dyesForRecord(record)]).toEqual([YELLOW]);
  });

  it("files a colour between two families under the nearer one", () => {
    // 0.2 sits between yellow (0.14) and green (0.3). The board carries no dye
    // for it, and a painting that is mostly that colour still has to be findable.
    const record = painting("olive", [[[0.2, 0.5, 0.4], 1]]);
    expect([...dyesForRecord(record)]).toEqual([YELLOW]);
  });

  it("ignores a colour too grey to have a hue", () => {
    const record = painting("grey", [
      [[0.15, 0.4, 0.5], 0.6],
      [[0.56, 0.03, 0.4], 0.4],
    ]);
    expect([...dyesForRecord(record)]).toEqual([YELLOW]);
  });

  it("takes the whole palette when the collection has no cluster shares", () => {
    const record = {
      id: "old-pipeline",
      features: { color: { dominant_hsl: [0.56, 0.5, 0.4], palette_hsl: [[0.56, 0.5, 0.4], [0.15, 0.4, 0.5]] } },
    };
    expect([...dyesForRecord(record)].sort()).toEqual([YELLOW, BLUE]);
  });

  it("falls back to the dominant colour when there is no palette at all", () => {
    const record = { id: "dominant-only", features: { color: { dominant_hsl: [0.56, 0.5, 0.4] } } };
    expect([...dyesForRecord(record)]).toEqual([BLUE]);
  });
});

describe("filtering by several dyes", () => {
  const records = [
    painting("yellow", [[[0.15, 0.4, 0.5], 1]]),
    painting("yellow-and-blue", [[[0.15, 0.4, 0.5], 0.6], [[0.56, 0.5, 0.4], 0.4]]),
    painting("yellow-blue-and-green", [
      [[0.15, 0.4, 0.5], 0.4],
      [[0.56, 0.5, 0.4], 0.35],
      [[0.32, 0.5, 0.4], 0.25],
    ]),
  ];

  it("returns only paintings holding every pinned dye", () => {
    const matched = filterPaintings(records, colorFilter({ hues: [YELLOW, BLUE] }), {});
    expect(matched.map((record) => record.id)).toEqual(["yellow-and-blue", "yellow-blue-and-green"]);
  });

  it("narrows with each dye added", () => {
    const one = filterPaintings(records, colorFilter({ hues: [YELLOW] }), {});
    const two = filterPaintings(records, colorFilter({ hues: [YELLOW, BLUE] }), {});
    const three = filterPaintings(records, colorFilter({ hues: [YELLOW, BLUE, GREEN] }), {});
    expect([one.length, two.length, three.length]).toEqual([3, 2, 1]);
  });

  it("returns nothing when no painting carries the whole set", () => {
    const matched = filterPaintings(
      [painting("yellow", [[[0.15, 0.4, 0.5], 1]])],
      colorFilter({ hues: [YELLOW, GREEN] }),
      {},
    );
    expect(matched).toEqual([]);
  });

  it("counts a painting under each of its dyes", () => {
    const both = [painting("both", [[[0.15, 0.4, 0.5], 0.5], [[0.56, 0.5, 0.4], 0.5]])];
    const counts = buildOptionCounts(both, {});
    expect(counts.hues[YELLOW]).toBe(1);
    expect(counts.hues[BLUE]).toBe(1);
  });

  // What the cloths advertise once one is pinned: the board counts them over the
  // paintings still on the table, so each one shows what it would leave behind.
  it("counts a dye over what the pinned dyes already left", () => {
    const pinned = filterPaintings(records, colorFilter({ hues: [BLUE] }), {});
    const counts = buildHueCounts(pinned);
    expect(counts[BLUE]).toBe(2);
    expect(counts[GREEN]).toBe(1);
  });
});

describe("saturation and lightness bands", () => {
  // Every dominant colour here is "muted" against the absolute 0.35 cutoff.
  const records = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3].map((saturation, index) =>
    painting(`p${index}`, [[[0.15, saturation, 0.5], 1]]),
  );

  it("cuts the collection into thirds instead of using fixed cutoffs", () => {
    const stats = buildColorStats(records);
    expect(getSaturationBand(0.05, stats)).toBe("muted");
    expect(getSaturationBand(0.2, stats)).toBe("medium");
    expect(getSaturationBand(0.3, stats)).toBe("vivid");
    expect(getSaturationBand(0.3)).toBe("muted");
  });

  it("keeps the absolute cutoffs when the collection is too uniform to rank", () => {
    const flat = [0.4, 0.4, 0.4].map((saturation, index) =>
      painting(`flat${index}`, [[[0.15, saturation, 0.5], 1]]),
    );
    expect(getSaturationBand(0.4, buildColorStats(flat))).toBe("medium");
  });

  it("reads the band off the whole canvas, not off the dye that matched", () => {
    const record = painting("dark-with-blue", [
      [[0.15, 0.4, 0.12], 0.6],
      [[0.48, 0.5, 0.9], 0.4],
    ]);
    const stats = buildColorStats([record]);
    const matched = filterPaintings([record], colorFilter({ hues: [BLUE], light: "dark" }), stats);
    expect(matched).toHaveLength(1);
  });
});

// The sliders describe the dye you pinned - "that teal, dark overall". On their
// own they are not a colour search: a band alone would quietly cut the table to
// a third with nothing on the board to say why.
describe("bands only bite once a dye is pinned", () => {
  const records = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3].map((saturation, index) =>
    painting(`p${index}`, [[[0.15, saturation, 0.5], 1]]),
  );
  const stats = buildColorStats(records);

  it("leaves the collection alone when only a band is set", () => {
    const matched = filterPaintings(records, colorFilter({ sat: "vivid" }), stats);
    expect(matched).toHaveLength(records.length);
  });

  it("leaves the collection alone when only a lamp is set", () => {
    const matched = filterPaintings(records, colorFilter({ light: "dark" }), stats);
    expect(matched).toHaveLength(records.length);
  });

  it("narrows to the band once a dye is pinned", () => {
    const matched = filterPaintings(records, colorFilter({ hues: [YELLOW], sat: "vivid" }), stats);
    expect(matched.map((record) => record.id)).toEqual(["p4", "p5"]);
  });

  it("does not count a bandless board as an active filter", () => {
    expect(isColorActive({ hues: [], sat: "vivid", light: "dark" })).toBe(false);
    expect(isColorActive({ hues: [YELLOW], sat: null, light: null })).toBe(true);
  });
});
