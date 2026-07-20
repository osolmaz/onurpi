import { describe, expect, it } from "vitest";

import { foldDisplay } from "./fold-policy.ts";

describe("fold display policy", () => {
  it("shows complete turns in expanded mode", () => {
    expect(
      foldDisplay({
        aborted: false,
        isAnchor: false,
        isFinalAssistant: false,
        isRecentActivity: false,
        mode: "expanded",
        settled: true,
      }),
    ).toBe("original");
  });

  it("shows only recent activity while live mode is running", () => {
    expect(
      foldDisplay({
        aborted: false,
        isAnchor: false,
        isFinalAssistant: false,
        isRecentActivity: true,
        mode: "live",
        settled: false,
      }),
    ).toBe("original");
    expect(
      foldDisplay({
        aborted: false,
        isAnchor: false,
        isFinalAssistant: false,
        isRecentActivity: false,
        mode: "live",
        settled: false,
      }),
    ).toBe("hidden");
  });

  it("shows only a summary while final-only mode is running", () => {
    expect(
      foldDisplay({
        aborted: false,
        isAnchor: true,
        isFinalAssistant: false,
        isRecentActivity: true,
        mode: "final-only",
        settled: false,
      }),
    ).toBe("summary");
    expect(
      foldDisplay({
        aborted: false,
        isAnchor: false,
        isFinalAssistant: false,
        isRecentActivity: true,
        mode: "final-only",
        settled: false,
      }),
    ).toBe("hidden");
  });

  it("folds settled activity while retaining the final assistant message", () => {
    expect(
      foldDisplay({
        aborted: false,
        isAnchor: true,
        isFinalAssistant: false,
        isRecentActivity: false,
        mode: "live",
        settled: true,
      }),
    ).toBe("summary");
    expect(
      foldDisplay({
        aborted: false,
        isAnchor: false,
        isFinalAssistant: false,
        isRecentActivity: true,
        mode: "live",
        settled: true,
      }),
    ).toBe("hidden");
    expect(
      foldDisplay({
        aborted: false,
        isAnchor: false,
        isFinalAssistant: true,
        isRecentActivity: false,
        mode: "live",
        settled: true,
      }),
    ).toBe("original");
  });

  it("uses the aborted assistant as the summary anchor instead of a final response", () => {
    expect(
      foldDisplay({
        aborted: true,
        isAnchor: true,
        isFinalAssistant: true,
        isRecentActivity: true,
        mode: "live",
        settled: true,
      }),
    ).toBe("summary");
    expect(
      foldDisplay({
        aborted: true,
        isAnchor: false,
        isFinalAssistant: true,
        isRecentActivity: false,
        mode: "live",
        settled: true,
      }),
    ).toBe("hidden");
  });
});
