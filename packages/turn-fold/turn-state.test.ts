import { describe, expect, it, vi } from "vitest";

import { TurnFoldState } from "./turn-state.ts";

function assistantMessage(
  timestamp: number,
  content: Record<string, unknown>[],
  stopReason?: string,
): Record<string, unknown> {
  return {
    content,
    provider: "test",
    role: "assistant",
    timestamp,
    ...(stopReason === undefined ? {} : { stopReason }),
  };
}

function registerAssistant(
  state: TurnFoldState,
  component: object,
  message: Record<string, unknown>,
): void {
  state.registerAssistantMessage(message);
  state.associateAssistant(component, message);
}

function compactionEntry(id: string, timestamp: number): Record<string, unknown> {
  return {
    firstKeptEntryId: "kept",
    id,
    parentId: null,
    summary: "summary",
    timestamp: new Date(timestamp).toISOString(),
    tokensBefore: 10_000,
    type: "compaction",
  };
}

function compactionAssociation(
  compactionEntryId: string,
  timestamp: number,
  turnStartedAt = 100,
  turnEntryIds: readonly string[] = [],
) {
  return { compactionEntryId, timestamp, turnEntryIds, turnStartedAt };
}

function compactionMessage(timestamp: number): Record<string, unknown> {
  return { role: "compactionSummary", summary: "summary", timestamp, tokensBefore: 10_000 };
}

function editToolResult(
  toolCallId: string,
  path: string,
  additions: number,
  deletions: number,
  isError = false,
): Record<string, unknown> {
  const removed = Array.from({ length: deletions }, (_, index) => `-old ${String(index)}`);
  const added = Array.from({ length: additions }, (_, index) => `+new ${String(index)}`);
  return {
    content: [{ text: isError ? "failed" : "edited", type: "text" }],
    details: {
      patch: [
        `--- ${path}`,
        `+++ ${path}`,
        `@@ -1,${String(deletions)} +1,${String(additions)} @@`,
        ...removed,
        ...added,
        "",
      ].join("\n"),
    },
    isError,
    role: "toolResult",
    timestamp: 120,
    toolCallId,
    toolName: "edit",
  };
}

describe("compact streaming", () => {
  it("shows only the latest three visible activity rows", () => {
    const state = new TurnFoldState();
    const components = [{}, {}, {}, {}];

    state.ensureActive(100);
    components.forEach((component, index) => {
      registerAssistant(
        state,
        component,
        assistantMessage(110 + index, [{ text: `Message ${String(index + 1)}`, type: "text" }]),
      );
    });

    expect(components.map((component) => state.viewFor(component)?.display)).toEqual([
      "streaming-summary",
      "original",
      "original",
      "original",
    ]);
  });

  it("reuses cached layout and assistant snapshots across unchanged renders", () => {
    const state = new TurnFoldState();
    const component = {};
    let contentReads = 0;
    const contentItem = {
      get text() {
        contentReads += 1;
        return "Cached";
      },
      get type() {
        contentReads += 1;
        return "text";
      },
    };
    const message = assistantMessage(110, [contentItem]);
    state.ensureActive(100);
    registerAssistant(state, component, message);
    state.viewFor(component);
    contentReads = 0;
    const sortSpy = vi.spyOn(Array.prototype, "sort");
    try {
      for (let index = 0; index < 100; index += 1) {
        state.associateAssistant(component, message);
        state.viewFor(component, 200 + index);
      }

      expect(contentReads).toBe(0);
      expect(sortSpy).not.toHaveBeenCalled();
    } finally {
      sortSpy.mockRestore();
    }
  });

  it("invalidates existing rows as new activity changes the compact window", () => {
    const state = new TurnFoldState();
    let firstInvalidations = 0;
    const first = { invalidate: () => (firstInvalidations += 1) };
    const second = { invalidate: () => undefined };

    state.ensureActive(100);
    registerAssistant(state, first, assistantMessage(110, [{ text: "First", type: "text" }]));
    const afterFirst = firstInvalidations;
    registerAssistant(state, second, assistantMessage(120, [{ text: "Second", type: "text" }]));

    expect(firstInvalidations).toBeGreaterThan(afterFirst);
    const beforeTokenUpdate = firstInvalidations;
    state.registerAssistantMessage(
      assistantMessage(120, [{ text: "Second, still streaming", type: "text" }]),
    );
    expect(firstInvalidations).toBe(beforeTokenUpdate);
    const beforeModeChange = firstInvalidations;
    state.setMode("expanded");
    expect(firstInvalidations).toBeGreaterThan(beforeModeChange);
  });

  it("counts one assistant response across streaming tool-call updates", () => {
    const state = new TurnFoldState();
    const component = {};
    const start = assistantMessage(110, []);
    const updated = {
      ...assistantMessage(110, [{ id: "tool-live", name: "read", type: "toolCall" }]),
      responseId: "response-arrived-during-streaming",
    };

    state.ensureActive(100);
    state.beginAssistantMessage(start);
    state.registerAssistantMessage(updated);
    state.associateAssistant(component, updated);
    state.endAssistantMessage({ ...updated, stopReason: "toolUse" });

    expect(state.viewFor(component, 120)?.summary.messages).toBe(1);
  });

  it("distinguishes assistant responses that share a timestamp", () => {
    const state = new TurnFoldState();
    const first = {};
    const tool = {};
    const final = {};
    const firstMessage = assistantMessage(110, [
      { text: "Working", type: "text" },
      { id: "same-ms-tool", name: "read", type: "toolCall" },
    ]);
    const finalMessage = assistantMessage(110, [{ text: "Done", type: "text" }]);

    state.ensureActive(100);
    state.beginAssistantMessage(firstMessage);
    state.associateAssistant(first, firstMessage);
    state.endAssistantMessage(firstMessage);
    state.registerToolStart("same-ms-tool", 110);
    state.associateTool(tool, "same-ms-tool");
    state.beginAssistantMessage(finalMessage);
    state.associateAssistant(final, finalMessage);
    state.endAssistantMessage(finalMessage);
    state.settleActive(120);

    expect(state.viewFor(first)?.display).toBe("settled-summary");
    expect(state.viewFor(tool)?.display).toBe("hidden");
    expect(state.viewFor(final, 120)).toMatchObject({
      display: "settled-final",
      summary: { messages: 2, tools: 1 },
    });
  });

  it("counts tool rows but not tool-call-only assistant shells", () => {
    const state = new TurnFoldState();
    const first = {};
    const second = {};
    const third = {};
    const toolOnlyAssistant = {};
    const tool = {};
    const toolMessage = assistantMessage(140, [
      { id: "tool-live", name: "read", type: "toolCall" },
    ]);

    state.ensureActive(100);
    registerAssistant(state, first, assistantMessage(110, [{ text: "First", type: "text" }]));
    registerAssistant(state, second, assistantMessage(120, [{ text: "Second", type: "text" }]));
    registerAssistant(state, third, assistantMessage(130, [{ text: "Third", type: "text" }]));
    registerAssistant(state, toolOnlyAssistant, toolMessage);
    state.registerToolStart("tool-live", 145);
    state.associateTool(tool, "tool-live");

    expect(state.viewFor(first)?.display).toBe("streaming-summary");
    expect(state.viewFor(first, 150)?.summary).toMatchObject({
      hiddenActivities: 1,
      messages: 4,
      running: true,
      tools: 1,
    });
    expect(state.viewFor(second)?.display).toBe("original");
    expect(state.viewFor(third)?.display).toBe("original");
    expect(state.viewFor(toolOnlyAssistant)?.display).toBe("hidden");
    expect(state.viewFor(tool)?.display).toBe("original");
  });
});

describe("edit diffstats", () => {
  it("aggregates successful edit operations by tool call and unique file", () => {
    const state = new TurnFoldState();
    const final = {};
    const message = assistantMessage(180, [{ text: "Done", type: "text" }]);

    state.ensureActive(100);
    for (const toolCallId of ["edit-1", "edit-2", "edit-3"]) {
      state.registerToolStart(toolCallId, 110);
    }
    const first = editToolResult("edit-1", "src/a.ts", 2, 1);
    state.registerToolResult(first);
    state.registerToolResult(first);
    state.registerToolResult(editToolResult("edit-2", "src/a.ts", 1, 2));
    state.registerToolResult(editToolResult("edit-3", "src/b.ts", 0, 3));
    registerAssistant(state, final, message);
    state.settleActive(200);

    expect(state.viewFor(final, 200)?.summary.fileDiff).toEqual({
      additions: 3,
      deletions: 6,
      files: 2,
    });
  });

  it("ignores failed, malformed, and non-edit tool results", () => {
    const state = new TurnFoldState();
    const final = {};
    const message = assistantMessage(180, [{ text: "Done", type: "text" }]);

    state.ensureActive(100);
    state.registerToolStart("failed", 110);
    state.registerToolResult(editToolResult("failed", "src/a.ts", 1, 1, true));
    state.registerToolStart("malformed", 120);
    state.registerToolResult({
      ...editToolResult("malformed", "src/a.ts", 1, 1),
      details: { patch: "not a patch" },
    });
    state.registerToolStart("read", 130);
    state.registerToolResult({
      ...editToolResult("read", "src/a.ts", 1, 1),
      toolName: "read",
    });
    registerAssistant(state, final, message);
    state.settleActive(200);

    expect(state.viewFor(final, 200)?.summary.fileDiff).toBeUndefined();
  });

  it("reconstructs the same diffstat from historical tool results", () => {
    const state = new TurnFoldState();
    const final = {};
    const finalMessage = assistantMessage(180, [{ text: "Done", type: "text" }]);

    state.loadHistory([
      { message: { content: "prompt", role: "user", timestamp: 100 }, type: "message" },
      {
        message: assistantMessage(110, [
          { id: "history-a", name: "edit", type: "toolCall" },
          { id: "history-b", name: "edit", type: "toolCall" },
        ]),
        type: "message",
      },
      { message: editToolResult("history-a", "src/a.ts", 4, 2), type: "message" },
      { message: editToolResult("history-b", "src/b.ts", 1, 3), type: "message" },
      { message: finalMessage, timestamp: new Date(200).toISOString(), type: "message" },
    ]);
    state.associateAssistant(final, finalMessage);

    expect(state.viewFor(final, 200)?.summary.fileDiff).toEqual({
      additions: 5,
      deletions: 5,
      files: 2,
    });
    state.setMode("expanded");
    expect(state.viewFor(final, 200)?.display).toBe("original");
  });
});

describe("compact settled turns", () => {
  it("hides all intermediate activity and keeps the last assistant message", () => {
    const state = new TurnFoldState();
    const intermediate = {};
    const tool = {};
    const finalAssistant = {};
    const first = assistantMessage(110, [
      { text: "Checking", type: "text" },
      { id: "tool-1", name: "read", type: "toolCall" },
    ]);
    const final = assistantMessage(140, [{ text: "Done", type: "text" }]);

    state.ensureActive(100);
    registerAssistant(state, intermediate, first);
    state.registerToolStart("tool-1", 115);
    state.associateTool(tool, "tool-1");
    registerAssistant(state, finalAssistant, final);
    state.settleActive(150);

    expect(state.viewFor(intermediate)?.display).toBe("settled-summary");
    expect(state.viewFor(tool)?.display).toBe("hidden");
    expect(state.viewFor(finalAssistant, 150)).toEqual({
      display: "settled-final",
      summary: {
        aborted: false,
        compactions: 0,
        completedAt: 150,
        durationMs: 50,
        failedTools: 0,
        hiddenActivities: 0,
        messages: 2,
        running: false,
        tools: 1,
      },
    });
  });

  it("keeps an interrupted assistant message visible", () => {
    const state = new TurnFoldState();
    const prior = {};
    const interrupted = {};

    state.ensureActive(100);
    registerAssistant(state, prior, assistantMessage(110, [{ text: "Working", type: "text" }]));
    registerAssistant(state, interrupted, assistantMessage(120, [], "aborted"));
    state.abortActive(130);

    expect(state.viewFor(prior)?.display).toBe("settled-summary");
    expect(state.viewFor(interrupted, 130)).toMatchObject({
      display: "settled-final",
      summary: { aborted: true, durationMs: 30, running: false },
    });
  });

  it("keeps retries in one turn and does not label a successful retry interrupted", () => {
    const state = new TurnFoldState();
    const failed = {};
    const failedTool = {};
    const succeeded = {};
    const error = assistantMessage(
      110,
      [{ id: "retry-tool", name: "read", type: "toolCall" }],
      "error",
    );
    const success = assistantMessage(140, [{ text: "Recovered", type: "text" }]);

    state.ensureActive(100);
    registerAssistant(state, failed, error);
    state.registerToolStart("retry-tool", 120);
    state.associateTool(failedTool, "retry-tool");
    registerAssistant(state, succeeded, success);
    state.settleActive(150);

    expect(state.viewFor(failed)?.display).toBe("settled-summary");
    expect(state.viewFor(failedTool)?.display).toBe("hidden");
    expect(state.viewFor(succeeded, 150)).toMatchObject({
      display: "settled-final",
      summary: { aborted: false, messages: 2 },
    });
  });

  it("keeps the latest visible message when a run settles without a final response", () => {
    const state = new TurnFoldState();
    const message = {};
    const tool = {};

    state.ensureActive(100);
    registerAssistant(state, message, assistantMessage(110, [{ text: "Partial", type: "text" }]));
    state.registerToolStart("tool-1", 120);
    state.associateTool(tool, "tool-1");
    state.settleActive(130);

    expect(state.viewFor(message)?.display).toBe("settled-summary-final");
    expect(state.viewFor(tool)?.display).toBe("hidden");
  });
});

describe("ephemeral compactions", () => {
  it("attaches an automatic compaction to the active turn", () => {
    const state = new TurnFoldState();
    const compaction = {};
    const final = {};
    const entry = compactionEntry("compact-live", 120);
    const message = assistantMessage(140, [{ text: "Done", type: "text" }]);

    state.ensureActive(100);
    expect(state.registerCompaction(entry, "overflow")).toEqual(
      compactionAssociation("compact-live", 120),
    );
    state.associateCompaction(compaction, compactionMessage(125));
    registerAssistant(state, final, message);
    state.settleActive(150);

    expect(state.viewFor(compaction, 150)).toMatchObject({
      display: "settled-summary",
      summary: { compactions: 1 },
    });
    expect(state.viewFor(final, 150)).toMatchObject({
      display: "settled-final",
      summary: { compactions: 1 },
    });
  });

  it("keeps duplicate compaction events attached without double counting", () => {
    const state = new TurnFoldState();
    const first = {};
    const second = {};
    const entry = compactionEntry("compact-duplicate", 120);

    state.ensureActive(100);
    expect(state.registerCompaction(entry, "overflow")).toEqual(
      compactionAssociation("compact-duplicate", 120),
    );
    expect(state.registerCompaction(entry, "overflow")).toEqual(
      compactionAssociation("compact-duplicate", 120),
    );
    state.associateCompaction(first, compactionMessage(125));
    state.associateCompaction(second, compactionMessage(126));
    state.settleActive(130);

    expect(state.viewFor(first)?.summary.compactions).toBe(1);
    expect(state.viewFor(second)?.display).toBe("hidden");
  });

  it("associates Pi's rebuilt and live rows without leaking into the next compaction", () => {
    const state = new TurnFoldState();
    const rebuiltAutomatic = {};
    const liveAutomatic = {};
    const rebuiltManual = {};
    const liveManual = {};

    state.ensureActive(100);
    state.registerCompaction(compactionEntry("compact-same-time", 120), "threshold");
    state.associateCompaction(rebuiltAutomatic, compactionMessage(120));
    state.associateCompaction(liveAutomatic, compactionMessage(125));
    state.settleActive(130);
    state.registerCompaction(compactionEntry("compact-after", 140), "manual");
    state.associateCompaction(rebuiltManual, compactionMessage(140));
    state.associateCompaction(liveManual, compactionMessage(145));

    expect(state.viewFor(rebuiltAutomatic)?.summary.compactions).toBe(1);
    expect(state.viewFor(liveAutomatic)?.display).toBe("hidden");
    expect(state.viewFor(rebuiltManual)).toBeUndefined();
    expect(state.viewFor(liveManual)).toBeUndefined();
  });

  it("leaves a compaction standalone when no turn is active", () => {
    const state = new TurnFoldState();
    const compaction = {};
    const entry = compactionEntry("compact-manual", 120);

    state.ensureActive(100);
    expect(state.registerCompaction(entry, "manual")).toBeUndefined();
    state.associateCompaction(compaction, compactionMessage(120));

    expect(state.viewFor(compaction)).toBeUndefined();
  });
});

describe("expanded transcript", () => {
  it("shows every associated row before and after settlement", () => {
    const state = new TurnFoldState();
    const first = {};
    const second = {};

    state.setMode("expanded");
    state.ensureActive(100);
    registerAssistant(state, first, assistantMessage(110, [{ text: "First", type: "text" }]));
    registerAssistant(state, second, assistantMessage(120, [{ text: "Second", type: "text" }]));

    expect(state.viewFor(first)?.display).toBe("original");
    state.settleActive(130);
    expect(state.viewFor(first)?.display).toBe("original");
    expect(state.viewFor(second)?.display).toBe("original");
  });

  it("shows an attached compaction with Pi's original row", () => {
    const state = new TurnFoldState();
    const compaction = {};

    state.setMode("expanded");
    state.ensureActive(100);
    state.registerCompaction(compactionEntry("compact-expanded", 120), "threshold");
    state.associateCompaction(compaction, compactionMessage(120));

    expect(state.viewFor(compaction)?.display).toBe("original");
  });

  it("toggles back to compact mode", () => {
    const state = new TurnFoldState();
    expect(state.toggleExpanded()).toBe("expanded");
    expect(state.toggleExpanded()).toBe("compact");
  });
});

describe("historical transcript", () => {
  it("associates user components with local-time source timestamps in order", () => {
    const state = new TurnFoldState();
    const first = {};
    const second = {};

    state.loadHistory([
      { message: { content: "same", role: "user", timestamp: 100 }, type: "message" },
      { message: assistantMessage(110, [{ text: "done", type: "text" }]), type: "message" },
      { message: { content: "same", role: "user", timestamp: 200 }, type: "message" },
    ]);
    state.associateUser(first);
    state.associateUser(first);
    state.associateUser(second);

    expect(state.userTimestampFor(first)).toBe(100);
    expect(state.userTimestampFor(second)).toBe(200);
  });

  it("reconstructs turns and keeps each last assistant response", () => {
    const state = new TurnFoldState();
    const firstIntermediate = {};
    const firstTool = {};
    const firstFinal = {};
    const secondFinal = {};
    const first = assistantMessage(110, [
      { text: "Checking", type: "text" },
      { id: "tool-history", name: "read", type: "toolCall" },
    ]);
    const firstDone = assistantMessage(130, [{ text: "First done", type: "text" }]);
    const secondDone = assistantMessage(220, [{ text: "Second done", type: "text" }]);

    state.loadHistory([
      { message: { content: "first", role: "user", timestamp: 100 }, type: "message" },
      { message: first, type: "message" },
      {
        message: {
          content: [{ text: "result", type: "text" }],
          role: "toolResult",
          timestamp: 120,
          toolCallId: "tool-history",
        },
        type: "message",
      },
      { message: firstDone, type: "message" },
      { message: { content: "second", role: "user", timestamp: 200 }, type: "message" },
      { message: secondDone, type: "message" },
    ]);
    state.associateAssistant(firstIntermediate, first);
    state.associateTool(firstTool, "tool-history");
    state.associateAssistant(firstFinal, firstDone);
    state.associateAssistant(secondFinal, secondDone);

    expect(state.viewFor(firstIntermediate)?.display).toBe("settled-summary");
    expect(state.viewFor(firstTool)?.display).toBe("hidden");
    expect(state.viewFor(firstFinal)?.display).toBe("settled-final");
    expect(state.viewFor(secondFinal)?.display).toBe("settled-summary-final");
  });
});

describe("historical compactions", () => {
  it("restores an explicitly attached automatic compaction", () => {
    const state = new TurnFoldState();
    const compaction = {};
    const final = {};
    const message = assistantMessage(140, [{ text: "Done", type: "text" }]);

    state.loadHistory(
      [
        compactionEntry("compact-history", 120),
        {
          id: "turn-user",
          message: { content: "prompt", role: "user", timestamp: 100 },
          type: "message",
        },
        { id: "turn-assistant", message, type: "message" },
      ],
      new Map([
        [
          "compact-history",
          compactionAssociation("compact-history", 120, 100, ["turn-user", "turn-assistant"]),
        ],
      ]),
    );
    state.associateCompaction(compaction, compactionMessage(120));
    state.associateAssistant(final, message);

    expect(state.viewFor(compaction)).toMatchObject({
      display: "settled-summary",
      summary: { compactions: 1 },
    });
    expect(state.viewFor(final)).toMatchObject({
      display: "settled-final",
      summary: { compactions: 1 },
    });
  });

  it("restores a split-turn compaction when the user entry is no longer visible", () => {
    const state = new TurnFoldState();
    const compaction = {};
    const final = {};
    const message = assistantMessage(140, [{ text: "Retained split turn", type: "text" }]);

    state.loadHistory(
      [compactionEntry("compact-split", 120), { id: "kept-assistant", message, type: "message" }],
      new Map([
        [
          "compact-split",
          compactionAssociation("compact-split", 120, 100, ["omitted-user", "kept-assistant"]),
        ],
      ]),
    );
    state.associateCompaction(compaction, compactionMessage(120));
    state.associateAssistant(final, message);

    expect(state.viewFor(compaction)).toMatchObject({
      display: "settled-summary",
      summary: { compactions: 1 },
    });
    expect(state.viewFor(final)?.display).toBe("settled-final");
  });

  it("counts multiple automatic compactions without treating them as activity", () => {
    const state = new TurnFoldState();
    const firstCompaction = {};
    const secondCompaction = {};
    const final = {};
    const message = assistantMessage(160, [{ text: "Done", type: "text" }]);

    state.loadHistory(
      [
        compactionEntry("compact-second", 140),
        {
          id: "turn-user",
          message: { content: "prompt", role: "user", timestamp: 100 },
          type: "message",
        },
        { id: "turn-assistant", message, type: "message" },
      ],
      new Map([
        [
          "compact-first",
          compactionAssociation("compact-first", 120, 100, ["turn-user", "turn-assistant"]),
        ],
        [
          "compact-second",
          compactionAssociation("compact-second", 140, 100, ["turn-user", "turn-assistant"]),
        ],
      ]),
    );
    state.associateCompaction(firstCompaction, compactionMessage(120));
    state.associateCompaction(secondCompaction, compactionMessage(140));
    state.associateAssistant(final, message);

    expect(state.viewFor(firstCompaction)).toMatchObject({
      display: "settled-summary",
      summary: { compactions: 2, hiddenActivities: 0 },
    });
    expect(state.viewFor(secondCompaction)?.display).toBe("hidden");
    expect(state.viewFor(final)?.display).toBe("settled-final");
  });

  it("keeps compactions outside the process registry standalone", () => {
    const state = new TurnFoldState();
    const manual = {};
    const unannotated = {};

    state.loadHistory([
      { message: { content: "first", role: "user", timestamp: 100 }, type: "message" },
      compactionEntry("compact-manual", 120),
      { message: assistantMessage(140, [{ text: "Done", type: "text" }]), type: "message" },
      { message: { content: "second", role: "user", timestamp: 200 }, type: "message" },
      compactionEntry("compact-old", 220),
      { message: assistantMessage(240, [{ text: "Done", type: "text" }]), type: "message" },
    ]);
    state.associateCompaction(manual, compactionMessage(120));
    state.associateCompaction(unannotated, compactionMessage(220));

    expect(state.viewFor(manual)).toBeUndefined();
    expect(state.viewFor(unannotated)).toBeUndefined();
  });

  it("preserves a live compaction through a deferred transcript rebuild", () => {
    const state = new TurnFoldState();
    const oldStandaloneCompaction = {};
    const compaction = {};
    const entry = compactionEntry("compact-rebuild", 120);

    state.ensureActive(100);
    state.registerCompaction(entry, "overflow");
    state.deferHistoryReload(() => [
      { message: { content: "old", role: "user", timestamp: 10 }, type: "message" },
      compactionEntry("compact-old-manual", 30),
      { message: { content: "prompt", role: "user", timestamp: 100 }, type: "message" },
    ]);
    state.reloadHistoryForNewComponent(oldStandaloneCompaction);
    state.associateCompaction(oldStandaloneCompaction, compactionMessage(30));
    state.associateCompaction(compaction, compactionMessage(999));
    state.settleActive(150);

    expect(state.viewFor(oldStandaloneCompaction)).toBeUndefined();
    expect(state.viewFor(compaction, 150)).toMatchObject({
      display: "settled-summary",
      summary: { compactions: 1 },
    });
  });
});

describe("historical transcript timing and reload", () => {
  it("uses persisted completion time when restoring worked duration", () => {
    const state = new TurnFoldState();
    const component = {};
    const message = assistantMessage(1_100, [{ text: "Done", type: "text" }]);

    state.loadHistory([
      { message: { content: "prompt", role: "user", timestamp: 1_000 }, type: "message" },
      { message, timestamp: new Date(5_000).toISOString(), type: "message" },
    ]);
    state.associateAssistant(component, message);

    expect(state.viewFor(component)?.summary.durationMs).toBe(4_000);
  });

  it("preserves an active turn through a deferred transcript rebuild", () => {
    const state = new TurnFoldState();
    const original = {};
    const rebuilt = {};
    const message = assistantMessage(110, [
      { text: "Active", type: "text" },
      { id: "edit-reload", name: "edit", type: "toolCall" },
    ]);
    const editResult = editToolResult("edit-reload", "src/reload.ts", 2, 1);

    state.ensureActive(100);
    registerAssistant(state, original, message);
    state.registerToolResult(editResult);
    state.deferHistoryReload(() => [
      { message: { content: "prompt", role: "user", timestamp: 100 }, type: "message" },
      { message, type: "message" },
      { message: editResult, type: "message" },
    ]);
    state.reloadHistoryForNewComponent(rebuilt);
    state.associateAssistant(rebuilt, message);

    expect(state.viewFor(original)).toBeUndefined();
    expect(state.viewFor(rebuilt)?.display).toBe("original");
    state.settleActive(120);
    expect(state.viewFor(rebuilt)).toMatchObject({
      display: "settled-summary-final",
      summary: { fileDiff: { additions: 2, deletions: 1, files: 1 } },
    });
  });

  it("ignores malformed and unrelated session data", () => {
    const state = new TurnFoldState();
    const unknown = {};

    state.loadHistory([
      null,
      {},
      { type: "other" },
      { message: { role: "assistant" }, type: "message" },
      { message: { content: "prompt", role: "user" }, type: "message" },
      { message: { role: "toolResult", timestamp: 3 }, type: "message" },
    ]);
    state.beginAssistantMessage({ role: "assistant" });
    state.beginAssistantMessage({ role: "user", timestamp: 330 });
    state.registerAssistantMessage({ role: "assistant" });
    state.endAssistantMessage({ content: [], role: "assistant", timestamp: 330 });
    state.settleActive();
    state.associateAssistant(unknown, { role: "assistant" });
    state.associateAssistant(unknown, assistantMessage(340, []));
    state.associateTool(unknown, "missing");
    state.ensureActive(350);
    expect(state.registerCompaction({}, "overflow")).toBeUndefined();
    expect(
      state.registerCompaction({ id: "bad-time", timestamp: "invalid" }, "threshold"),
    ).toBeUndefined();
    state.associateCompaction(unknown, { role: "compactionSummary" });
    state.settleActive();

    expect(state.viewFor(unknown)).toBeUndefined();
  });
});
