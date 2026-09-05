import { describe, expect, it } from "vitest";

import { TURN_FOLD_RUN_ENTRY } from "./run-boundary.ts";
import {
  DEFAULT_PROJECTED_COMPONENT_LIMIT,
  projectTranscriptEntries,
} from "./transcript-projection.ts";
import { selectTranscriptEntries } from "./transcript-windows.ts";
import { TurnFoldState } from "./turn-state.ts";

type Entry = Parameters<typeof selectTranscriptEntries>[0][number];

function extensionRun(run: number): Entry[] {
  const promptId = `extension-prompt-${String(run)}`;
  const entries: Entry[] = [
    {
      content: "Continue the extension run.",
      customType: "test-extension-event",
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
        runId: `extension-run-${String(run)}`,
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

function workflowHeavyRun(run: number): Entry[] {
  const startedAt = run * 1_000;
  const promptId = `user-${String(run)}`;
  const entries: Entry[] = [
    {
      id: promptId,
      message: { content: `Prompt ${String(run)}`, role: "user", timestamp: startedAt },
      parentId: null,
      timestamp: new Date(startedAt).toISOString(),
      type: "message",
    },
  ];

  for (let step = 1; step <= 4; step += 1) {
    entries.push({
      content: `Step ${String(step)}`,
      customType: "pi-workflows-agent-step",
      details: { run, step },
      display: true,
      id: `workflow-step-${String(run)}-${String(step)}`,
      parentId: null,
      timestamp: new Date(startedAt + step).toISOString(),
      type: "custom_message",
    });
  }

  if (run % 40 === 0) {
    const calls = Array.from({ length: 12 }, (_, index) => ({
      arguments: { path: `fixture-${String(run)}-${String(index)}` },
      id: `tool-${String(run)}-${String(index)}`,
      name: "read",
      type: "toolCall" as const,
    }));
    entries.push({
      id: `tool-source-${String(run)}`,
      message: {
        api: "test",
        content: calls,
        model: "test",
        provider: "test",
        role: "assistant",
        stopReason: "toolUse",
        timestamp: startedAt + 10,
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
      timestamp: new Date(startedAt + 10).toISOString(),
      type: "message",
    });
    for (let index = 0; index < calls.length; index += 1) {
      entries.push({
        id: `tool-result-${String(run)}-${String(index)}`,
        message: {
          content: [{ text: `Result ${String(index)}`, type: "text" }],
          isError: false,
          role: "toolResult",
          timestamp: startedAt + 11 + index,
          toolCallId: `tool-${String(run)}-${String(index)}`,
          toolName: "read",
        },
        parentId: null,
        timestamp: new Date(startedAt + 11 + index).toISOString(),
        type: "message",
      });
    }
  }

  entries.push(
    {
      id: `final-${String(run)}`,
      message: {
        api: "test",
        content: [{ text: `Final ${String(run)}`, type: "text" }],
        model: "test",
        provider: "test",
        role: "assistant",
        stopReason: "stop",
        timestamp: startedAt + 100,
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
      timestamp: new Date(startedAt + 100).toISOString(),
      type: "message",
    },
    {
      customType: TURN_FOLD_RUN_ENTRY,
      data: {
        promptEntryId: promptId,
        runId: `run-${String(run)}`,
        startedAt,
        version: 1,
      },
      id: `run-boundary-${String(run)}`,
      parentId: null,
      timestamp: new Date(startedAt + 101).toISOString(),
      type: "custom",
    },
  );

  if (run % 25 === 0) {
    entries.push({
      firstKeptEntryId: promptId,
      id: `workflow-compaction-${String(run)}`,
      parentId: null,
      summary: `Compaction ${String(run)}`,
      timestamp: new Date(startedAt + 102).toISOString(),
      tokensBefore: 100_000,
      type: "compaction",
    });
  }
  return entries;
}

function isWorkflowStep(entry: Entry): boolean {
  return entry.type === "custom_message" && entry.customType === "pi-workflows-agent-step";
}

function displayedRunNumbers(entries: readonly Entry[]): number[] {
  const runs: number[] = [];
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    runs.push(Number(entry.id.replace("user-", "")));
  }
  return runs;
}

function expectWorkflowPrompts(entries: readonly Entry[], displayedIds: ReadonlySet<string>): void {
  for (const entry of entries) {
    if (!isWorkflowStep(entry)) continue;
    const match = /^workflow-step-(\d+)-\d+$/.exec(entry.id);
    expect(match).not.toBeNull();
    expect(displayedIds.has(`user-${match?.[1] ?? "missing"}`)).toBe(true);
  }
}

function expectOriginalOrder(source: readonly Entry[], displayed: readonly Entry[]): void {
  let previousSourceIndex = -1;
  for (const entry of displayed) {
    const sourceIndex = source.indexOf(entry);
    expect(sourceIndex).toBeGreaterThan(previousSourceIndex);
    expect(source[sourceIndex]).toBe(entry);
    previousSourceIndex = sourceIndex;
  }
}

function expectUserTimestamps(source: readonly Entry[], displayed: readonly Entry[]): void {
  const state = new TurnFoldState();
  state.applyHistoryProjection(source, displayed);
  for (const entry of displayed) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const component = {};
    state.associateUser(component);
    expect(state.userTimestampFor(component)).toBe(entry.message.timestamp);
  }
}

describe("Custom-run-heavy transcript windows", () => {
  it("bounds a synthetic 4,228-run session by durable run boundaries", () => {
    const branch = Array.from({ length: 4_228 }, (_, index) => extensionRun(index + 1)).flat();
    const selected = selectTranscriptEntries(branch, 3);

    expect(branch.length).toBeGreaterThan(12_000);
    expect(selected[0]?.id).toBe("extension-prompt-4000");
    expect(selected.at(-1)?.id).toBe("boundary-4228");
    expect(selected.length).toBeLessThan(1_000);
  });

  it("keeps full-history compact replay within the component budget", () => {
    const branch = Array.from({ length: 4_228 }, (_, index) => extensionRun(index + 1)).flat();
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

  it("keeps one prompt-complete suffix in a workflow-heavy session", () => {
    const branch = Array.from({ length: 200 }, (_, index) => workflowHeavyRun(index + 1)).flat();
    const projection = projectTranscriptEntries(branch, {
      activeRun: false,
      attachedCompactionEntryIds: new Set(),
    });
    const displayedIds = new Set(projection.displayEntries.map((entry) => entry.id));
    const displayedRuns = displayedRunNumbers(projection.displayEntries);
    const firstDisplayedRun = displayedRuns[0] ?? 201;

    expect(branch.filter(isWorkflowStep)).toHaveLength(800);
    expect(projection.projectedComponentCount).toBeLessThanOrEqual(
      DEFAULT_PROJECTED_COMPONENT_LIMIT,
    );
    expect(displayedRuns).toEqual(
      Array.from({ length: 201 - firstDisplayedRun }, (_, index) => firstDisplayedRun + index),
    );
    expect(projection.omittedRunCount).toBe(firstDisplayedRun - 1);
    expect(projection.oldestRetainedEntryId).toBe(`user-${String(firstDisplayedRun)}`);
    expectWorkflowPrompts(projection.displayEntries, displayedIds);
    expectOriginalOrder(branch, projection.displayEntries);
    expectUserTimestamps(branch, projection.displayEntries);
  });
});
