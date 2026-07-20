import type { Theme } from "@earendil-works/pi-coding-agent";
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
    completedAt: undefined,
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
      "▶ 7 earlier activities · 10 tools · 4 msgs",
    );
  });

  it("formats normal and interrupted settled summaries", () => {
    expect(formatSettledSummary(summary())).toBe("▶ Worked for 1m 5s · 10 tools · 4 msgs");
    expect(formatSettledSummary(summary({ aborted: true, failedTools: 1 }))).toBe(
      "▶ Worked for 1m 5s · 10 tools · 4 msgs · 1 failure · interrupted",
    );

    const completedAt = new Date(2026, 6, 20, 18, 43).getTime();
    expect(formatSettledSummary(summary({ completedAt }))).toBe(
      "▶ Worked for 1m 5s · 10 tools · 4 msgs",
    );
  });

  it("renders themed summary lines in bold", () => {
    const testTheme = {
      bold: (text: string) => `<bold>${text}</bold>`,
      fg: (_color: string, text: string) => text,
    } as unknown as Theme;
    const rendered = renderSettledSummary(summary(), 100, testTheme);
    expect(rendered[1]).toBe("<bold>▶ Worked for 1m 5s · 10 tools · 4 msgs</bold>");
  });

  it("renders summaries with a leading blank row and respects zero width", () => {
    expect(renderStreamingSummary(summary({ running: true }), 100, undefined)).toEqual([
      "",
      "▶ 7 earlier activities · 10 tools · 4 msgs",
    ]);
    expect(renderSettledSummary(summary({ durationMs: 500 }), 100, undefined)).toEqual([
      "",
      "▶ Worked for <1s · 10 tools · 4 msgs",
    ]);
    expect(renderSettledSummary(summary(), 0, undefined)).toEqual([]);
  });
});
