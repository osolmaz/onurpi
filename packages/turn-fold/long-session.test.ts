import { describe, expect, it } from "vitest";

import { TURN_FOLD_RUN_ENTRY } from "./run-boundary.ts";
import {
  DEFAULT_PROJECTED_COMPONENT_LIMIT,
  projectTranscriptEntries,
} from "./transcript-projection.ts";
import { selectTranscriptEntries } from "./transcript-windows.ts";

type Entry = Parameters<typeof selectTranscriptEntries>[0][number];

function goalRun(run: number): Entry[] {
  const promptId = `goal-prompt-${String(run)}`;
  const entries: Entry[] = [
    {
      content: "Continue the active goal.",
      customType: "pi-goal-event",
      details: { kind: "continuation" },
      display: true,
      id: promptId,
      parentId: null,
      timestamp: new Date(run * 10).toISOString(),
      type: "custom_message",
    },
    {
      id: `assistant-${String(run)}`,
      message: {
        api: "test",
        content: [{ text: `Run ${String(run)}`, type: "text" }],
        model: "test",
        provider: "test",
        role: "assistant",
        stopReason: "stop",
        timestamp: run * 10 + 1,
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
          input: 0,
          output: 0,
          totalTokens: 0,
        },
      },
      parentId: null,
      timestamp: new Date(run * 10 + 1).toISOString(),
      type: "message",
    },
    {
      customType: TURN_FOLD_RUN_ENTRY,
      data: {
        promptEntryId: promptId,
        runId: `goal-run-${String(run)}`,
        startedAt: run * 10,
        version: 1,
      },
      id: `boundary-${String(run)}`,
      parentId: null,
      timestamp: new Date(run * 10 + 2).toISOString(),
      type: "custom",
    },
  ];
  if (run % 100 === 0) {
    entries.push({
      firstKeptEntryId: promptId,
      id: `compaction-${String(run)}`,
      parentId: null,
      summary: "summary",
      timestamp: new Date(run * 10 + 3).toISOString(),
      tokensBefore: 100_000,
      type: "compaction",
    });
  }
  return entries;
}

describe("Goal-heavy transcript windows", () => {
  it("bounds a synthetic 4,228-run session by durable run boundaries", () => {
    const branch = Array.from({ length: 4_228 }, (_, index) => goalRun(index + 1)).flat();
    const selected = selectTranscriptEntries(branch, 3);

    expect(branch.length).toBeGreaterThan(12_000);
    expect(selected[0]?.id).toBe("goal-prompt-4000");
    expect(selected.at(-1)?.id).toBe("boundary-4228");
    expect(selected.length).toBeLessThan(1_000);
  });

  it("keeps full-history compact replay within the component budget", () => {
    const branch = Array.from({ length: 4_228 }, (_, index) => goalRun(index + 1)).flat();
    const projection = projectTranscriptEntries(branch, {
      activeRun: false,
      attachedCompactionEntryIds: new Set(),
    });

    expect(projection.projectedComponentCount).toBeLessThanOrEqual(
      DEFAULT_PROJECTED_COMPONENT_LIMIT,
    );
    expect(projection.omittedRunCount).toBeGreaterThan(3_900);
    expect(projection.displayEntries.length).toBeLessThanOrEqual(DEFAULT_PROJECTED_COMPONENT_LIMIT);
  });
});
