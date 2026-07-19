import { describe, expect, it } from "vitest";

import { formatFoldSummary, renderFoldSummary } from "./render-patches.ts";

describe("fold summary rendering", () => {
  it("formats a settled turn", () => {
    expect(
      formatFoldSummary({
        aborted: false,
        durationMs: 65_000,
        failedTools: 1,
        intermediateMessages: 2,
        outputApproximate: true,
        outputTokens: 1_250,
        running: false,
        tools: 3,
      }),
    ).toBe("▶ Worked for 1m 5s · ~1.3K out · 3 tools · 2 msgs · 1 failure · Ctrl+Shift+O");
  });

  it("formats live activity", () => {
    expect(
      formatFoldSummary({
        aborted: false,
        durationMs: 500,
        failedTools: 0,
        intermediateMessages: 0,
        outputApproximate: true,
        outputTokens: 100,
        running: true,
        tools: 1,
      }),
    ).toBe("◆ Working · 1 tool");
  });

  it("places a blank line before a folded summary with duration first", () => {
    expect(
      renderFoldSummary(
        {
          aborted: false,
          durationMs: 5_000,
          failedTools: 0,
          intermediateMessages: 1,
          outputApproximate: false,
          outputTokens: 42,
          running: false,
          tools: 2,
        },
        100,
        undefined,
      ),
    ).toEqual(["", "▶ Worked for 5s · 42 out · 2 tools · 1 msg · Ctrl+Shift+O"]);
  });

  it("renders the folded summary together with an abort notice", () => {
    expect(
      renderFoldSummary(
        {
          aborted: true,
          durationMs: 5_000,
          failedTools: 0,
          intermediateMessages: 0,
          outputApproximate: false,
          outputTokens: 0,
          running: false,
          tools: 1,
        },
        100,
        undefined,
      ),
    ).toEqual(["", "▶ Worked for 5s · 0 out · 1 tool · Ctrl+Shift+O", "Operation aborted"]);
  });
});
