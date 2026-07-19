import { describe, expect, it } from "vitest";

import { formatFoldSummary, renderFoldSummary } from "./render-patches.ts";

describe("fold summary rendering", () => {
  it("formats a settled turn", () => {
    expect(
      formatFoldSummary({
        durationMs: 65_000,
        failedTools: 1,
        intermediateMessages: 2,
        running: false,
        tools: 3,
      }),
    ).toBe("▶ Worked for 1m 5s · 3 tools · 2 msgs · 1 failure · Ctrl+Shift+O");
  });

  it("formats live activity", () => {
    expect(
      formatFoldSummary({
        durationMs: 500,
        failedTools: 0,
        intermediateMessages: 0,
        running: true,
        tools: 1,
      }),
    ).toBe("◆ Working · 1 tool");
  });

  it("places a blank line before a folded summary with duration first", () => {
    expect(
      renderFoldSummary(
        {
          durationMs: 5_000,
          failedTools: 0,
          intermediateMessages: 1,
          running: false,
          tools: 2,
        },
        100,
        undefined,
      ),
    ).toEqual(["", "▶ Worked for 5s · 2 tools · 1 msg · Ctrl+Shift+O"]);
  });
});
