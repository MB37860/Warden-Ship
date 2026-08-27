import { describe, expect, it } from "vitest";
import {
  buildCreativityReadings,
  buildInfluenceNetwork,
  normalizeHistoricalNodes,
} from "../utils/historicalAnalysis";

const coords = [
  {
    id: "early",
    filename: "0000001_Artemisia - Dawn.jpg",
    artist: "Artemisia",
    x: -0.8,
    y: -0.4,
    year: 1600,
    distinctiveness: 0.1,
    bridge_score: 0.2,
  },
  {
    id: "middle",
    filename: "0000002_Bruno - Passage.jpg",
    artist: "Bruno",
    x: 0,
    y: 0,
    year: 1700,
    distinctiveness: 0.4,
    bridge_score: 0.3,
    neighbors: [{ id: "early", similarity: 0.9 }],
  },
  {
    id: "late",
    filename: "0000003_Celia - Arrival.jpg",
    artist: "Celia",
    x: 0.8,
    y: 0.5,
    year: 1800,
    distinctiveness: 0.95,
    bridge_score: 0.8,
    neighbors: [
      { id: "middle", similarity: 0.8 },
      { id: "early", similarity: 0.2 },
    ],
  },
];

describe("historical analysis visual data", () => {
  const nodes = normalizeHistoricalNodes(coords);

  it("allows creativity readings to shift from later influence to originality", () => {
    const influenceWeighted = buildCreativityReadings(nodes, 0, "overall");
    const originalityWeighted = buildCreativityReadings(nodes, 1, "overall");

    expect(
      influenceWeighted.find((node) => node.id === "early").creativity,
    ).toBeGreaterThan(
      influenceWeighted.find((node) => node.id === "late").creativity,
    );
    expect(
      originalityWeighted.find((node) => node.id === "late").creativity,
    ).toBeGreaterThan(
      originalityWeighted.find((node) => node.id === "early").creativity,
    );
  });

  it("creates only forward-in-time artist influence routes", () => {
    const network = buildInfluenceNetwork(nodes);

    expect(network.links.map((link) => link.id)).toContain("Artemisia->Bruno");
    expect(network.links.map((link) => link.id)).toContain("Bruno->Celia");
    expect(network.links.map((link) => link.id)).not.toContain("Celia->Bruno");

    const focused = buildInfluenceNetwork(nodes, "Bruno");
    expect(
      focused.links.every((link) => link.from === "Bruno" || link.to === "Bruno"),
    ).toBe(true);

    const zeroStrengthNodes = normalizeHistoricalNodes([
      ...coords,
      {
        id: "silent",
        filename: "0000004_Dara - Stillness.jpg",
        artist: "Dara",
        x: 0.4,
        y: 0.2,
        year: 1650,
        neighbors: [{ id: "early", similarity: 0 }],
      },
    ]);
    expect(buildInfluenceNetwork(zeroStrengthNodes).links.map((link) => link.id))
      .not.toContain("Artemisia->Dara");
  });

  it("does not invent timeline positions for undated works", () => {
    const undated = normalizeHistoricalNodes([
      ...coords,
      {
        id: "unknown-date",
        filename: "0000004_Dara - Stillness.jpg",
        artist: "Dara",
        x: 0.4,
        y: 0.2,
        year: null,
      },
    ]);

    expect(undated.map((node) => node.id)).not.toContain("unknown-date");
  });
});
