import { describe, expect, it } from "vitest";

import { foldDisplay } from "./fold-policy.ts";

function display(overrides: Partial<Parameters<typeof foldDisplay>[0]> = {}) {
  return foldDisplay({
    isFinalAnchor: false,
    isRecentActivity: false,
    isSettledSummaryAnchor: false,
    isStreamingSummaryAnchor: false,
    settled: false,
    ...overrides,
  });
}

describe("fold display policy", () => {
  it("shows the overflow summary and latest activity while running", () => {
    expect(display({ isStreamingSummaryAnchor: true })).toBe("streaming-summary");
    expect(display({ isRecentActivity: true })).toBe("original");
    expect(display()).toBe("hidden");
  });

  it("shows the summary anchor before the final anchor after settlement", () => {
    expect(display({ isSettledSummaryAnchor: true, settled: true })).toBe("settled-summary");
    expect(display({ isFinalAnchor: true, settled: true })).toBe("settled-final");
    expect(display({ isFinalAnchor: true, isSettledSummaryAnchor: true, settled: true })).toBe(
      "settled-summary-final",
    );
    expect(display({ isRecentActivity: true, isStreamingSummaryAnchor: true, settled: true })).toBe(
      "hidden",
    );
  });
});
