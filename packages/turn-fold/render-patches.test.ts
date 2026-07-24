import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
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

function fileDiff(
  ...fileDiffs: { additions: number; deletions: number; path: string }[]
): NonNullable<FoldSummary["fileDiff"]> {
  return {
    additions: fileDiffs.reduce((total, diff) => total + diff.additions, 0),
    deletions: fileDiffs.reduce((total, diff) => total + diff.deletions, 0),
    fileDiffs,
    files: fileDiffs.length,
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

  it("formats edit diffstats in streaming and settled summaries", () => {
    const editDiff = fileDiff(
      { additions: 20, deletions: 5, path: "/workspace/a.ts" },
      { additions: 12, deletions: 3, path: "/workspace/b.ts" },
      { additions: 10, deletions: 3, path: "/workspace/c.ts" },
    );

    expect(formatStreamingSummary(summary({ fileDiff: editDiff, running: true }))).toBe(
      "▶ 7 earlier activities · 10 tools · 4 msgs · 3 files +42 −11",
    );
    expect(formatSettledSummary(summary({ fileDiff: editDiff }))).toBe(
      "▶ Worked for 1m 5s · 10 tools · 4 msgs · 3 files +42 −11",
    );
    expect(
      formatSettledSummary(
        summary({
          fileDiff: fileDiff({ additions: 0, deletions: 2, path: "/workspace/a.ts" }),
        }),
      ),
    ).toContain("1 file +0 −2");
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

  it("colors additions and deletions with the documented diff colors", () => {
    const testTheme = {
      bold: (text: string) => `<bold>${text}</bold>`,
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    } as unknown as Theme;
    const rendered = renderSettledSummary(
      summary({
        fileDiff: fileDiff(
          { additions: 20, deletions: 5, path: "/workspace/a.ts" },
          { additions: 12, deletions: 3, path: "/workspace/b.ts" },
          { additions: 10, deletions: 3, path: "/workspace/c.ts" },
        ),
      }),
      1_000,
      testTheme,
    )[1];

    expect(rendered).toContain("<toolDiffAdded>+42</toolDiffAdded>");
    expect(rendered).toContain("<toolDiffRemoved>−11</toolDiffRemoved>");
    expect(rendered).toContain("<warning>▶ Worked for 1m 5s · 10 tools · 4 msgs · 3 files ");
  });
});

describe("edited file path rendering", () => {
  it("renders each file's diff beside its absolute path in first-edit order", () => {
    const testTheme = {
      bold: (text: string) => `<bold>${text}</bold>`,
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    } as unknown as Theme;
    const rendered = renderSettledSummary(
      summary({
        fileDiff: fileDiff(
          { additions: 2, deletions: 1, path: "/workspace/project/src/a.ts" },
          { additions: 5, deletions: 3, path: "/outside/b.ts" },
        ),
      }),
      1_000,
      testTheme,
    );

    expect(rendered[1]).toContain("2 files ");
    expect(rendered.slice(2)).toEqual([
      "  <toolDiffContext>/workspace/project/src/a.ts</toolDiffContext> <toolDiffAdded>+2</toolDiffAdded> <toolDiffRemoved>−1</toolDiffRemoved>",
      "  <toolDiffContext>/outside/b.ts</toolDiffContext> <toolDiffAdded>+5</toolDiffAdded> <toolDiffRemoved>−3</toolDiffRemoved>",
    ]);
  });

  it("keeps each file on one line and truncates the path from the left", () => {
    const fullPath = "/workspace/project/a-very-long-directory/another-directory/file.ts";
    const editDiff = fileDiff({ additions: 12, deletions: 3, path: fullPath });

    for (let width = 1; width <= 40; width += 1) {
      const fileLines = renderSettledSummary(
        summary({ fileDiff: editDiff }),
        width,
        undefined,
      ).slice(2);
      expect(fileLines).toHaveLength(1);
      expect(visibleWidth(fileLines[0] ?? "")).toBeLessThanOrEqual(width);
    }

    const fileLine = renderSettledSummary(summary({ fileDiff: editDiff }), 28, undefined)[2];
    expect(fileLine).toContain("…");
    expect(fileLine).toContain("file.ts +12 −3");
    expect(fileLine).not.toContain("/workspace/project");
  });

  it("escapes terminal controls before rendering a file row", () => {
    const rendered = renderSettledSummary(
      summary({
        fileDiff: fileDiff({
          additions: 1,
          deletions: 0,
          path: "/tmp/unsafe\u001b]2;title\u0007.ts",
        }),
      }),
      80,
      undefined,
    )[2];

    expect(rendered).not.toContain("\u001b");
    expect(rendered).toContain("\\x1b");
    expect(rendered).toContain("\\x07");
    expect(rendered).toContain("+1 −0");
  });

  it("truncates styled summaries to the available visible width", () => {
    const ansiTheme = {
      bold: (text: string) => `\u001b[1m${text}\u001b[22m`,
      fg: (color: string, text: string) =>
        `${color === "toolDiffAdded" ? "\u001b[32m" : color === "toolDiffRemoved" ? "\u001b[31m" : "\u001b[33m"}${text}\u001b[39m`,
    } as unknown as Theme;
    const rendered = renderSettledSummary(
      summary({
        fileDiff: fileDiff(
          { additions: 20, deletions: 5, path: "/workspace/a.ts" },
          { additions: 12, deletions: 3, path: "/workspace/b.ts" },
          { additions: 10, deletions: 3, path: "/workspace/c.ts" },
        ),
      }),
      32,
      ansiTheme,
    )[1];

    expect(visibleWidth(rendered ?? "")).toBeLessThanOrEqual(32);
    expect(rendered).toContain("…");
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
