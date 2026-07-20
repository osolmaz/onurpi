import { describe, expect, it } from "vitest";

import {
  formatSettledSummary,
  formatStreamingSummary,
  renderSettledSummary,
  renderStreamingSummary,
} from "./render-patches.ts";
import type { FoldSummary } from "./turn-state.ts";

function summary(overrides: Partial<FoldSummary> = {}): FoldSummary {
  return {
    aborted: false,
    durationMs: 65_000,
    failedTools: 0,
    hiddenActivities: 7,
    messages: 4,
    running: false,
    tools: 10,
    ...overrides,
  };
}

describe("turn fold summary rendering", () => {
  it("formats the streaming overflow summary", () => {
    expect(formatStreamingSummary(summary({ running: true }))).toBe(
      "▶ 7 earlier activities · 10 tools · 4 msgs · Ctrl+Shift+O",
    );
  });

  it("formats normal and interrupted settled summaries", () => {
    expect(formatSettledSummary(summary())).toBe(
      "▶ Worked for 1m 5s · 10 tools · 4 msgs · Ctrl+Shift+O",
    );
    expect(formatSettledSummary(summary({ aborted: true, failedTools: 1 }))).toBe(
      "▶ Worked for 1m 5s · 10 tools · 4 msgs · 1 failure · interrupted · Ctrl+Shift+O",
    );
  });

  it("renders summaries with a leading blank row and respects zero width", () => {
    expect(renderStreamingSummary(summary({ running: true }), 100, undefined)).toEqual([
      "",
      "▶ 7 earlier activities · 10 tools · 4 msgs · Ctrl+Shift+O",
    ]);
    expect(renderSettledSummary(summary({ durationMs: 500 }), 100, undefined)).toEqual([
      "",
      "▶ Worked for <1s · 10 tools · 4 msgs · Ctrl+Shift+O",
    ]);
    expect(renderSettledSummary(summary(), 0, undefined)).toEqual([]);
  });
});
