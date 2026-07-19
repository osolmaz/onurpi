import { describe, expect, it } from "vitest";

import { foldDisplay } from "./fold-policy.ts";

describe("fold display policy", () => {
  it("shows complete turns in expanded mode", () => {
    expect(
      foldDisplay({
        isAnchor: false,
        isFinalAssistant: false,
        mode: "expanded",
        settled: true,
      }),
    ).toBe("original");
  });

  it("shows activity while live mode is running", () => {
    expect(
      foldDisplay({
        isAnchor: false,
        isFinalAssistant: false,
        mode: "live",
        settled: false,
      }),
    ).toBe("original");
  });

  it("shows only a summary while final-only mode is running", () => {
    expect(
      foldDisplay({
        isAnchor: true,
        isFinalAssistant: false,
        mode: "final-only",
        settled: false,
      }),
    ).toBe("summary");
    expect(
      foldDisplay({
        isAnchor: false,
        isFinalAssistant: false,
        mode: "final-only",
        settled: false,
      }),
    ).toBe("hidden");
  });

  it("folds settled activity while retaining the final assistant message", () => {
    expect(
      foldDisplay({
        isAnchor: true,
        isFinalAssistant: false,
        mode: "live",
        settled: true,
      }),
    ).toBe("summary");
    expect(
      foldDisplay({
        isAnchor: false,
        isFinalAssistant: false,
        mode: "live",
        settled: true,
      }),
    ).toBe("hidden");
    expect(
      foldDisplay({
        isAnchor: false,
        isFinalAssistant: true,
        mode: "live",
        settled: true,
      }),
    ).toBe("original");
  });
});
