import { describe, expect, it } from "vitest";

import { isTranscriptDensity, nextTranscriptDensity, TRANSCRIPT_DENSITIES } from "./density.ts";

describe("turn fold modes", () => {
  it("recognizes only compact and expanded modes", () => {
    expect(TRANSCRIPT_DENSITIES).toEqual(["compact", "expanded"]);
    expect(isTranscriptDensity("compact")).toBe(true);
    expect(isTranscriptDensity("expanded")).toBe(true);
    expect(isTranscriptDensity("live")).toBe(false);
  });

  it("toggles between both modes", () => {
    expect(nextTranscriptDensity("compact")).toBe("expanded");
    expect(nextTranscriptDensity("expanded")).toBe("compact");
  });
});
