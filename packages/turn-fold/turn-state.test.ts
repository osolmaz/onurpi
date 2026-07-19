import { describe, expect, it } from "vitest";

import { TurnFoldState } from "./turn-state.ts";

function assistantMessage(
  timestamp: number,
  content: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    content,
    provider: "test",
    role: "assistant",
    timestamp,
  };
}

describe("TurnFoldState", () => {
  it("folds an active run after it settles", () => {
    const state = new TurnFoldState();
    const intermediate = {};
    const tool = {};
    const finalAssistant = {};
    const intermediateMessage = assistantMessage(110, [
      { text: "I will inspect the project.", type: "text" },
      { id: "tool-1", name: "read", type: "toolCall" },
    ]);
    const finalMessage = assistantMessage(140, [{ text: "The project is ready.", type: "text" }]);

    state.ensureActive(100);
    state.registerAssistantMessage(intermediateMessage);
    state.associateAssistant(intermediate, intermediateMessage);
    state.registerToolStart("tool-1", 115);
    state.associateTool(tool, "tool-1");
    state.registerAssistantMessage(finalMessage);
    state.associateAssistant(finalAssistant, finalMessage);
    state.settleActive(150);

    expect(state.viewFor(intermediate, 150)).toEqual({
      display: "summary",
      summary: {
        durationMs: 50,
        failedTools: 0,
        intermediateMessages: 1,
        running: false,
        tools: 1,
      },
    });
    expect(state.viewFor(tool, 150)?.display).toBe("hidden");
    expect(state.viewFor(finalAssistant, 150)?.display).toBe("original");
  });

  it("renders one live summary in final-only mode", () => {
    const state = new TurnFoldState();
    const assistant = {};
    const tool = {};
    const message = assistantMessage(110, [{ id: "tool-1", name: "read", type: "toolCall" }]);

    state.setMode("final-only");
    state.ensureActive(100);
    state.registerAssistantMessage(message);
    state.associateAssistant(assistant, message);
    state.registerToolStart("tool-1", 115);
    state.associateTool(tool, "tool-1");

    expect(state.viewFor(assistant, 120)?.display).toBe("summary");
    expect(state.viewFor(assistant, 120)?.summary.running).toBe(true);
    expect(state.viewFor(tool, 120)?.display).toBe("hidden");
  });

  it("reconstructs historical groups without changing session messages", () => {
    const state = new TurnFoldState();
    const intermediate = {};
    const tool = {};
    const finalAssistant = {};
    const first = assistantMessage(210, [
      { text: "Checking.", type: "text" },
      { id: "tool-history", name: "bash", type: "toolCall" },
    ]);
    const final = assistantMessage(240, [{ text: "Done.", type: "text" }]);
    const entries = [
      { message: { content: "Do the work", role: "user", timestamp: 200 }, type: "message" },
      { message: first, type: "message" },
      {
        message: {
          content: [{ text: "failed", type: "text" }],
          isError: true,
          role: "toolResult",
          timestamp: 230,
          toolCallId: "tool-history",
        },
        type: "message",
      },
      { message: final, type: "message" },
    ];

    state.loadHistory(entries);
    state.associateAssistant(intermediate, first);
    state.associateTool(tool, "tool-history");
    state.associateAssistant(finalAssistant, final);

    expect(state.viewFor(intermediate, 250)?.summary).toEqual({
      durationMs: 40,
      failedTools: 1,
      intermediateMessages: 1,
      running: false,
      tools: 1,
    });
    expect(state.viewFor(finalAssistant, 250)?.display).toBe("original");
  });

  it("uses the latest text-only assistant message as the final response", () => {
    const state = new TurnFoldState();
    const first = {};
    const second = {};
    const third = {};
    const firstMessage = assistantMessage(10, [
      { id: "tool-a", type: "toolCall" },
      { text: "Starting", type: "text" },
    ]);
    const secondMessage = assistantMessage(20, [{ text: "Almost done", type: "text" }]);
    const thirdMessage = assistantMessage(30, [{ text: "Done", type: "text" }]);

    state.ensureActive(1);
    for (const [component, message] of [
      [first, firstMessage],
      [second, secondMessage],
      [third, thirdMessage],
    ] as const) {
      state.registerAssistantMessage(message);
      state.associateAssistant(component, message);
    }
    state.settleActive(40);

    expect(state.viewFor(first, 40)?.display).toBe("summary");
    expect(state.viewFor(second, 40)?.display).toBe("hidden");
    expect(state.viewFor(third, 40)?.display).toBe("original");
  });

  it("ignores malformed or unrelated session data", () => {
    const state = new TurnFoldState();
    const unknownComponent = {};

    state.loadHistory([
      null,
      {},
      { type: "other" },
      { message: { role: "assistant" }, type: "message" },
      { message: { content: "prompt", role: "user" }, type: "message" },
      { message: { content: "invalid", role: "assistant", timestamp: 2 }, type: "message" },
      { message: { role: "toolResult", timestamp: 3 }, type: "message" },
    ]);
    state.registerAssistantMessage({ role: "assistant" });
    state.associateAssistant(unknownComponent, { role: "assistant" });
    state.associateTool(unknownComponent, "missing");
    state.registerToolEnd("missing", false);
    state.settleActive();

    expect(state.viewFor(unknownComponent)).toBeUndefined();
  });

  it("associates a tool with the active run only once", () => {
    const state = new TurnFoldState();
    const tool = {};
    state.ensureActive(10);
    state.registerToolStart("late-tool", 11);
    state.associateTool(tool, "late-tool");
    state.associateTool(tool, "late-tool");
    state.registerToolEnd("late-tool", true);
    state.settleActive(20);

    expect(state.viewFor(tool, 20)?.summary).toEqual({
      durationMs: 10,
      failedTools: 1,
      intermediateMessages: 0,
      running: false,
      tools: 1,
    });
  });

  it("toggles expanded mode back to the previous compact mode", () => {
    const state = new TurnFoldState();
    state.setMode("final-only");
    expect(state.toggleExpanded()).toBe("expanded");
    expect(state.toggleExpanded()).toBe("final-only");
  });
});
