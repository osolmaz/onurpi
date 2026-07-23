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
    compactions: 0,
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
    expect(formatStreamingSummary(summary({ compactions: 1, running: true }))).toBe(
      "▶ 7 earlier activities · 10 tools · 4 msgs · compacted",
    );
  });

  it("formats normal, compacted, and interrupted settled summaries", () => {
    expect(formatSettledSummary(summary())).toBe("▶ Worked for 1m 5s · 10 tools · 4 msgs");
    expect(formatSettledSummary(summary({ compactions: 1 }))).toBe(
      "▶ Worked for 1m 5s · 10 tools · 4 msgs · compacted",
    );
    expect(formatSettledSummary(summary({ compactions: 2 }))).toBe(
      "▶ Worked for 1m 5s · 10 tools · 4 msgs · 2 compactions",
    );
    expect(formatSettledSummary(summary({ aborted: true, failedTools: 1 }))).toBe(
      "▶ Worked for 1m 5s · 10 tools · 4 msgs · 1 failure · interrupted",
    );

    const completedAt = new Date(2026, 6, 20, 18, 43).getTime();
    expect(formatSettledSummary(summary({ completedAt }))).toBe(
      "▶ Worked for 1m 5s · 10 tools · 4 msgs",
    );
  });

  it.each([
    [500, "<1s"],
    [1_000, "1s"],
    [65_000, "1m 5s"],
    [3_600_000, "1h"],
    [3_723_000, "1h 2m 3s"],
    [90_061_000, "1d 1h 1m 1s"],
    [788_645_000, "1w 2d 3h 4m 5s"],
  ])("formats %i milliseconds with larger duration units", (durationMs, expected) => {
    expect(formatSettledSummary(summary({ durationMs, messages: 0, tools: 0 }))).toBe(
      `▶ Worked for ${expected}`,
    );
  });

  it("renders every themed summary line in bold warning color", () => {
    const testTheme = {
      bold: (text: string) => `<bold>${text}</bold>`,
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    } as unknown as Theme;

    expect(renderStreamingSummary(summary({ running: true }), 100, testTheme)[1]).toBe(
      "<bold><warning>▶ 7 earlier activities · 10 tools · 4 msgs</warning></bold>",
    );
    expect(renderSettledSummary(summary(), 100, testTheme)[1]).toBe(
      "<bold><warning>▶ Worked for 1m 5s · 10 tools · 4 msgs</warning></bold>",
    );
    expect(
      renderSettledSummary(summary({ aborted: true, failedTools: 1 }), 100, testTheme)[1],
    ).toContain("<warning>");
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
