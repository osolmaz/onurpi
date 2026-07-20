import { describe, expect, it } from "vitest";

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
    state.registerAssistantMessage(start);
    state.registerAssistantMessage(updated);
    state.associateAssistant(component, updated);

    expect(state.viewFor(component, 120)?.summary.messages).toBe(1);
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

    expect(state.viewFor(intermediate)?.display).toBe("hidden");
    expect(state.viewFor(tool)?.display).toBe("hidden");
    expect(state.viewFor(finalAssistant, 150)).toEqual({
      display: "settled-final",
      summary: {
        aborted: false,
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

    expect(state.viewFor(prior)?.display).toBe("hidden");
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

    expect(state.viewFor(failed)?.display).toBe("hidden");
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

    expect(state.viewFor(message)?.display).toBe("settled-final");
    expect(state.viewFor(tool)?.display).toBe("hidden");
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

  it("toggles back to compact mode", () => {
    const state = new TurnFoldState();
    expect(state.toggleExpanded()).toBe("expanded");
    expect(state.toggleExpanded()).toBe("compact");
  });
});

describe("historical transcript", () => {
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

    expect(state.viewFor(firstIntermediate)?.display).toBe("hidden");
    expect(state.viewFor(firstTool)?.display).toBe("hidden");
    expect(state.viewFor(firstFinal)?.display).toBe("settled-final");
    expect(state.viewFor(secondFinal)?.display).toBe("settled-final");
  });

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
    const message = assistantMessage(110, [{ text: "Active", type: "text" }]);

    state.ensureActive(100);
    registerAssistant(state, original, message);
    state.deferHistoryReload(() => [
      { message: { content: "prompt", role: "user", timestamp: 100 }, type: "message" },
      { message, type: "message" },
    ]);
    state.reloadHistoryForNewComponent(rebuilt);
    state.associateAssistant(rebuilt, message);

    expect(state.viewFor(original)).toBeUndefined();
    expect(state.viewFor(rebuilt)?.display).toBe("original");
    state.settleActive(120);
    expect(state.viewFor(rebuilt)?.display).toBe("settled-final");
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
    state.registerAssistantMessage({ role: "assistant" });
    state.associateAssistant(unknown, { role: "assistant" });
    state.associateTool(unknown, "missing");
    state.settleActive();

    expect(state.viewFor(unknown)).toBeUndefined();
  });
});
