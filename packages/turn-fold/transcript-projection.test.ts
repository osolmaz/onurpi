import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { projectTranscriptEntries } from "./transcript-projection.ts";

type Entries = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>;
type Entry = Entries[number];

function user(id: string, timestamp: number): Entry {
  return {
    id,
    message: { content: id, role: "user", timestamp },
    parentId: null,
    timestamp: new Date(timestamp).toISOString(),
    type: "message",
  };
}

function assistant(
  id: string,
  timestamp: number,
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): Entry {
  return {
    id,
    message: {
      api: "test",
      content,
      model: "test",
      provider: "test",
      role: "assistant",
      stopReason,
      timestamp,
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
    timestamp: new Date(timestamp).toISOString(),
    type: "message",
  };
}

function toolResult(id: string, toolCallId: string, isError = false): Entry {
  return {
    id,
    message: {
      content: [{ text: id, type: "text" }],
      isError,
      role: "toolResult",
      timestamp: 1,
      toolCallId,
      toolName: "read",
    },
    parentId: null,
    timestamp: "2026-07-22T00:00:00.000Z",
    type: "message",
  };
}

function compaction(id: string): Entry {
  return {
    firstKeptEntryId: id,
    id,
    parentId: null,
    summary: id,
    timestamp: "2026-07-22T00:00:00.000Z",
    tokensBefore: 1,
    type: "compaction",
  };
}

function customMessage(id: string, content: string): Entry {
  return {
    content,
    customType: "other-extension",
    details: {},
    display: true,
    id,
    parentId: null,
    timestamp: "2026-07-22T00:00:00.000Z",
    type: "custom_message",
  };
}

function custom(id: string): Entry {
  return {
    customType: "other-extension",
    data: { id },
    id,
    parentId: null,
    timestamp: "2026-07-22T00:00:00.000Z",
    type: "custom",
  };
}

function branchSummary(id: string): Entry {
  return {
    fromId: id,
    id,
    parentId: null,
    summary: id,
    timestamp: "2026-07-22T00:00:00.000Z",
    type: "branch_summary",
  };
}

function bashExecution(id: string): Entry {
  return {
    id,
    message: {
      cancelled: false,
      command: id,
      exitCode: 0,
      output: id,
      role: "bashExecution",
      timestamp: 1,
      truncated: false,
    },
    parentId: null,
    timestamp: "2026-07-22T00:00:00.000Z",
    type: "message",
  };
}

function ids(entries: Entries): unknown[] {
  return entries.map((entry) => entry.id);
}

function project(
  entries: Entries,
  overrides: Partial<Parameters<typeof projectTranscriptEntries>[1]> = {},
) {
  return projectTranscriptEntries(entries, {
    activeRun: false,
    attachedCompactionEntryIds: new Set(),
    ...overrides,
  });
}

describe("compact transcript projection", () => {
  it("keeps the prompt and final assistant while preserving unrelated custom entries", () => {
    const entries: Entries = [
      user("user", 100),
      assistant("tool-source", 110, [
        { arguments: {}, id: "read-1", name: "read", type: "toolCall" },
      ]),
      toolResult("tool-result", "read-1"),
      custom("custom"),
      assistant("final", 120, [{ text: "Done", type: "text" }]),
    ];

    const result = project(entries);

    expect(ids(result.displayEntries)).toEqual(["user", "custom", "final"]);
    expect(ids(result.sourceEntries)).toEqual(ids(entries));
    expect(result.projectedComponentCount).toBe(3);
  });

  it("keeps the source and result required for a terminal tool error", () => {
    const entries: Entries = [
      user("user", 100),
      assistant(
        "tool-source",
        110,
        [
          { arguments: {}, id: "read-1", name: "read", type: "toolCall" },
          { arguments: {}, id: "read-2", name: "read", type: "toolCall" },
        ],
        "error",
      ),
      toolResult("result-1", "read-1", true),
      toolResult("result-2", "read-2", true),
    ];

    expect(ids(project(entries).displayEntries)).toEqual([
      "user",
      "tool-source",
      "result-1",
      "result-2",
    ]);
  });

  it("omits a parallel tool batch that cannot fit the active three-activity tail", () => {
    const entries: Entries = [
      user("user", 100),
      assistant("first", 110, [{ text: "First", type: "text" }]),
      assistant("second", 120, [{ text: "Second", type: "text" }]),
      assistant("third", 130, [{ text: "Third", type: "text" }]),
      assistant("batch", 140, [
        { arguments: {}, id: "call-1", name: "read", type: "toolCall" },
        { arguments: {}, id: "call-2", name: "read", type: "toolCall" },
        { arguments: {}, id: "call-3", name: "read", type: "toolCall" },
        { arguments: {}, id: "call-4", name: "read", type: "toolCall" },
      ]),
      toolResult("result-1", "call-1"),
      toolResult("result-2", "call-2"),
      toolResult("result-3", "call-3"),
      toolResult("result-4", "call-4"),
    ];

    expect(ids(project(entries, { activeRun: true }).displayEntries)).toEqual([
      "user",
      "first",
      "second",
      "third",
    ]);
  });

  it("keeps at most the latest three reconstructed activities for an active run", () => {
    const entries: Entries = [
      user("user", 100),
      assistant("first", 110, [{ text: "First", type: "text" }]),
      assistant("tool-source", 120, [
        { arguments: {}, id: "read-1", name: "read", type: "toolCall" },
      ]),
      toolResult("tool-result", "read-1"),
      assistant("second", 130, [{ text: "Second", type: "text" }]),
      assistant("third", 140, [{ text: "Third", type: "text" }]),
    ];

    expect(ids(project(entries, { activeRun: true }).displayEntries)).toEqual([
      "user",
      "tool-source",
      "tool-result",
      "second",
      "third",
    ]);
  });

  it("reduces a giant settled run to two components", () => {
    const entries: Entry[] = [user("user", 100)];
    for (let index = 0; index < 1_000; index += 1) {
      const callId = `call-${String(index)}`;
      entries.push(
        assistant(`assistant-${String(index)}`, 200 + index, [
          { arguments: {}, id: callId, name: "read", type: "toolCall" },
        ]),
        toolResult(`result-${String(index)}`, callId),
      );
    }
    entries.push(assistant("final", 2_000, [{ text: "Done", type: "text" }]));

    const result = project(entries);

    expect(ids(result.displayEntries)).toEqual(["user", "final"]);
    expect(result.sourceEntries).toHaveLength(2_002);
    expect(result.projectedComponentCount).toBe(2);
  });
});

describe("compact transcript projection budgets and boundaries", () => {
  it("falls back to the prompt when one assistant exceeds the component budget", () => {
    const toolCalls: AssistantMessage["content"] = Array.from({ length: 600 }, (_, index) => ({
      arguments: {},
      id: `call-${String(index)}`,
      name: "read",
      type: "toolCall" as const,
    }));
    const entries: Entry[] = [user("user", 100), assistant("oversized", 110, toolCalls)];
    for (let index = 0; index < 600; index += 1) {
      entries.push(toolResult(`result-${String(index)}`, `call-${String(index)}`));
    }

    const result = project(entries);

    expect(ids(result.displayEntries)).toEqual(["user"]);
    expect(result.projectedComponentCount).toBe(1);
  });

  it("preserves unrelated custom messages inside a projected run", () => {
    const entries: Entries = [
      user("user", 100),
      assistant("hidden", 110, [{ text: "Working", type: "text" }]),
      customMessage("status", "Still working"),
      assistant("final", 120, [{ text: "Done", type: "text" }]),
    ];

    expect(ids(project(entries).displayEntries)).toEqual(["user", "status", "final"]);
  });

  it("falls back to the prompt when run-owned pass-through rows exceed the budget", () => {
    const entries: Entry[] = [
      user("user", 100),
      assistant("final", 110, [{ text: "Done", type: "text" }]),
    ];
    for (let index = 0; index < 512; index += 1) {
      entries.push(custom(`custom-${String(index)}`));
    }

    const result = project(entries);

    expect(ids(result.displayEntries)).toEqual(["user"]);
    expect(result.projectedComponentCount).toBe(1);
    expect(result.omittedRunCount).toBe(0);
    expect(result.oldestRetainedEntryId).toBe("user");
  });

  it("counts native branch summaries and bash executions in their run unit", () => {
    const entries: Entries = [
      user("user", 100),
      branchSummary("branch-1"),
      bashExecution("bash-1"),
      branchSummary("branch-2"),
      bashExecution("bash-2"),
      assistant("final", 110, [{ text: "Done", type: "text" }]),
    ];

    const result = project(entries, { componentLimit: 6 });

    expect(ids(result.displayEntries)).toEqual(ids(entries));
    expect(result.projectedComponentCount).toBe(6);
    expect(result.omittedRunCount).toBe(0);
  });

  it("stops at the first run that does not fit", () => {
    const entries: Entries = [
      user("old-user", 100),
      assistant("old-final", 110, [{ text: "Old", type: "text" }]),
      user("middle-user", 200),
      custom("middle-status-1"),
      custom("middle-status-2"),
      assistant("middle-final", 210, [{ text: "Middle", type: "text" }]),
      user("new-user", 300),
      assistant("new-final", 310, [{ text: "New", type: "text" }]),
    ];

    const result = project(entries, { componentLimit: 3 });

    expect(ids(result.displayEntries)).toEqual(["new-user", "new-final"]);
    expect(result.projectedComponentCount).toBe(2);
    expect(result.omittedRunCount).toBe(2);
    expect(result.oldestRetainedEntryId).toBe("new-user");
  });
});

describe("compact transcript chronological cutoff", () => {
  it("moves the chronological cutoff only from the top", () => {
    const first = user("first-user", 100);
    const firstFinal = assistant("first-final", 110, [{ text: "First", type: "text" }]);
    const second = user("second-user", 200);
    const secondFinal = assistant("second-final", 210, [{ text: "Second", type: "text" }]);
    const third = user("third-user", 300);
    const thirdFinal = assistant("third-final", 310, [{ text: "Third", type: "text" }]);
    const before: Entries = [first, firstFinal, second, secondFinal];
    const after: Entries = [...before, third, thirdFinal];

    expect(ids(project(before, { componentLimit: 4 }).displayEntries)).toEqual(ids(before));
    const shifted = project(after, { componentLimit: 4 });

    expect(ids(shifted.displayEntries)).toEqual([
      "second-user",
      "second-final",
      "third-user",
      "third-final",
    ]);
    expect(shifted.displayEntries[0]).toBe(second);
    expect(shifted.displayEntries.at(-1)).toBe(thirdFinal);
  });

  it("keeps standalone rows in chronological order without giving them priority", () => {
    const entries: Entries = [
      custom("standalone-1"),
      custom("standalone-2"),
      custom("standalone-3"),
      user("user", 100),
      assistant("final", 110, [{ text: "Done", type: "text" }]),
    ];

    const result = project(entries, { componentLimit: 3 });

    expect(ids(result.displayEntries)).toEqual(["standalone-3", "user", "final"]);
    expect(result.projectedComponentCount).toBe(3);
    expect(result.omittedRunCount).toBe(0);
  });

  it("falls back to the active prompt for a large tool batch and pass-through tail", () => {
    const toolCalls: AssistantMessage["content"] = Array.from({ length: 12 }, (_, index) => ({
      arguments: {},
      id: `active-call-${String(index)}`,
      name: "read",
      type: "toolCall" as const,
    }));
    const entries: Entry[] = [user("active-user", 100), assistant("active", 110, toolCalls)];
    for (let index = 0; index < 12; index += 1) {
      entries.push(toolResult(`active-result-${String(index)}`, `active-call-${String(index)}`));
    }
    for (let index = 0; index < 512; index += 1) {
      entries.push(customMessage(`status-${String(index)}`, "Working"));
    }

    const result = project(entries, { activeRun: true });

    expect(ids(result.displayEntries)).toEqual(["active-user"]);
    expect(result.projectedComponentCount).toBe(1);
    expect(result.omittedRunCount).toBe(0);
  });

  it("uses the prompt-only fallback when the component limit is one", () => {
    const entries: Entries = [
      user("user", 100),
      assistant("final", 110, [{ text: "Done", type: "text" }]),
    ];

    const result = project(entries, { componentLimit: 1 });

    expect(ids(result.displayEntries)).toEqual(["user"]);
    expect(result.projectedComponentCount).toBe(1);
    expect(result.oldestRetainedEntryId).toBe("user");
  });

  it("omits every older run when the newest run needs the prompt fallback", () => {
    const entries: Entry[] = [
      user("old-user", 100),
      assistant("old-final", 110, [{ text: "Old", type: "text" }]),
      user("new-user", 200),
    ];
    for (let index = 0; index < 4; index += 1) {
      entries.push(custom(`new-status-${String(index)}`));
    }

    const result = project(entries, { componentLimit: 3 });

    expect(ids(result.displayEntries)).toEqual(["new-user"]);
    expect(result.projectedComponentCount).toBe(1);
    expect(result.omittedRunCount).toBe(1);
    expect(result.oldestRetainedEntryId).toBe("new-user");
  });

  it("returns no synthetic anchor for standalone-only input", () => {
    const first = custom("first");
    const second = custom("second");
    const result = project([first, second], { componentLimit: 1 });

    expect(result.displayEntries).toEqual([second]);
    expect(result.displayEntries[0]).toBe(second);
    expect(result.projectedComponentCount).toBe(1);
    expect(result.omittedRunCount).toBe(0);
    expect(result.oldestRetainedEntryId).toBeUndefined();
  });

  it("returns an empty bounded projection for empty input", () => {
    expect(project([], { componentLimit: 1 })).toMatchObject({
      displayEntries: [],
      omittedRunCount: 0,
      projectedComponentCount: 0,
      sourceEntries: [],
    });
  });

  it("does not apply the prompt fallback to an older oversized run", () => {
    const entries: Entry[] = [user("old-user", 100)];
    for (let index = 0; index < 512; index += 1) {
      entries.push(custom(`old-status-${String(index)}`));
    }
    entries.push(
      assistant("old-final", 110, [{ text: "Old", type: "text" }]),
      user("new-user", 200),
      assistant("new-final", 210, [{ text: "New", type: "text" }]),
    );

    const result = project(entries);

    expect(ids(result.displayEntries)).toEqual(["new-user", "new-final"]);
    expect(result.projectedComponentCount).toBe(2);
    expect(result.omittedRunCount).toBe(1);
    expect(result.oldestRetainedEntryId).toBe("new-user");
  });

  it("omits old complete runs when the component budget is exhausted", () => {
    const entries: Entries = [
      user("old-user", 100),
      assistant("old-final", 110, [{ text: "Old", type: "text" }]),
      user("new-user", 200),
      assistant("new-final", 210, [{ text: "New", type: "text" }]),
    ];

    const result = project(entries, { componentLimit: 2 });

    expect(ids(result.displayEntries)).toEqual(["new-user", "new-final"]);
    expect(result.omittedRunCount).toBe(1);
  });

  it("hides attached compactions and preserves standalone compactions", () => {
    const entries: Entries = [
      user("user", 100),
      compaction("attached"),
      compaction("standalone"),
      assistant("final", 120, [{ text: "Done", type: "text" }]),
    ];

    expect(
      ids(
        project(entries, {
          attachedCompactionEntryIds: new Set(["attached"]),
        }).displayEntries,
      ),
    ).toEqual(["user", "standalone", "final"]);
  });

  it("retains a final response when the selected range begins mid-run", () => {
    const entries: Entries = [
      compaction("boundary"),
      assistant("hidden", 110, [{ text: "Hidden", type: "text" }]),
      assistant("final", 120, [{ text: "Done", type: "text" }]),
    ];

    expect(ids(project(entries).displayEntries)).toEqual(["boundary", "final"]);
  });
});
