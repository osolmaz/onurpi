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

  it("keeps every settled row native and hides only the rows no activity backs", () => {
    expect(display({ isSettledSummaryAnchor: true, settled: true })).toBe("original");
    expect(display({ isFinalAnchor: true, settled: true })).toBe("original");
    expect(display({ isFinalAnchor: true, isSettledSummaryAnchor: true, settled: true })).toBe(
      "original",
    );
    expect(display({ isRecentActivity: true, settled: true })).toBe("original");
    expect(display({ isRecentActivity: true, isStreamingSummaryAnchor: true, settled: true })).toBe(
      "original",
    );
    expect(display({ settled: true })).toBe("hidden");
  });
});
