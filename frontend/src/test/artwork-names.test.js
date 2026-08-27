import { describe, expect, it } from "vitest";
import {
  cleanArtworkFilename,
  getArtworkArtistName,
  getArtworkDisplayName,
  getArtworkTitleName,
  needsLogbookClassification,
} from "../utils/artworkNames";

describe("artwork name rules", () => {
  it("strips catalog ids and extensions, then shows artist and artwork title", () => {
    const record = {
      filename: "0000002_Ivan Aivazovsky - Storm at Sea.jpg",
    };

    expect(cleanArtworkFilename(record.filename)).toBe(
      "Ivan Aivazovsky - Storm at Sea",
    );
    expect(getArtworkArtistName(record)).toBe("Ivan Aivazovsky");
    expect(getArtworkTitleName(record)).toBe("Storm at Sea");
    expect(getArtworkDisplayName(record)).toBe(
      "Ivan Aivazovsky - Storm at Sea",
    );
  });

  it("prefers explicit metadata over filename parsing", () => {
    expect(
      getArtworkDisplayName({
        filename: "0000003_Unknown - Study.jpg",
        metadata: { artist: "Hilma af Klint", title: "The Swan" },
      }),
    ).toBe("Hilma af Klint - The Swan");
  });

  it("sends only missing or unknown filename labels to the logbook", () => {
    expect(
      needsLogbookClassification({
        filename: "0000002_Ivan Aivazovsky - Storm at Sea.jpg",
      }),
    ).toBe(false);
    expect(
      needsLogbookClassification({
        filename: "unknown_0000002.jpg",
      }),
    ).toBe(true);
    expect(
      needsLogbookClassification({
        filename: "0000002_Unknown Artist - Storm at Sea.jpg",
      }),
    ).toBe(true);
  });
});
