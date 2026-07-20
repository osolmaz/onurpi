import { describe, expect, it } from "vitest";

import { foldDisplay } from "./fold-policy.ts";

describe("fold display policy", () => {
  it("shows the overflow summary and latest activity while compact mode is running", () => {
    expect(
      foldDisplay({
        isFinalAnchor: false,
        isRecentActivity: false,
        isStreamingSummaryAnchor: true,
        mode: "compact",
        settled: false,
      }),
    ).toBe("streaming-summary");
    expect(
      foldDisplay({
        isFinalAnchor: false,
        isRecentActivity: true,
        isStreamingSummaryAnchor: false,
        mode: "compact",
        settled: false,
      }),
    ).toBe("original");
    expect(
      foldDisplay({
        isFinalAnchor: false,
        isRecentActivity: false,
        isStreamingSummaryAnchor: false,
        mode: "compact",
        settled: false,
      }),
    ).toBe("hidden");
  });

  it("shows only the final anchor after compact activity settles", () => {
    expect(
      foldDisplay({
        isFinalAnchor: true,
        isRecentActivity: false,
        isStreamingSummaryAnchor: false,
        mode: "compact",
        settled: true,
      }),
    ).toBe("settled-final");
    expect(
      foldDisplay({
        isFinalAnchor: false,
        isRecentActivity: true,
        isStreamingSummaryAnchor: true,
        mode: "compact",
        settled: true,
      }),
    ).toBe("hidden");
  });

  it("shows every row in expanded mode", () => {
    expect(
      foldDisplay({
        isFinalAnchor: false,
        isRecentActivity: false,
        isStreamingSummaryAnchor: false,
        mode: "expanded",
        settled: true,
      }),
    ).toBe("original");
  });
});
