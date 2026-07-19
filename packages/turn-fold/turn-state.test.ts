import { describe, expect, it } from "vitest";

import { TurnFoldState } from "./turn-state.ts";

function assistantMessage(
  timestamp: number,
  content: Record<string, unknown>[],
  outputTokens?: number,
): Record<string, unknown> {
  return {
    content,
    provider: "test",
    role: "assistant",
    timestamp,
    ...(outputTokens === undefined ? {} : { usage: { output: outputTokens } }),
  };
}

describe("TurnFoldState finalized output", () => {
  it("folds an active run after it settles", () => {
    const state = new TurnFoldState();
    const intermediate = {};
    const tool = {};
    const finalAssistant = {};
    const intermediateMessage = assistantMessage(
      110,
      [
        { text: "I will inspect the project.", type: "text" },
        { id: "tool-1", name: "read", type: "toolCall" },
      ],
      30,
    );
    const finalMessage = assistantMessage(
      140,
      [{ text: "The project is ready.", type: "text" }],
      8,
    );

    state.ensureActive(100);
    state.registerAssistantMessage(intermediateMessage);
    state.queueFinalAssistant(intermediateMessage);
    state.associateAssistant(intermediate, intermediateMessage);
    state.registerToolStart("tool-1", 115);
    state.associateTool(tool, "tool-1");
    state.registerAssistantMessage(finalMessage);
    state.queueFinalAssistant(finalMessage);
    state.associateAssistant(finalAssistant, finalMessage);
    state.finalizeAssistantOutputs([
      { message: intermediateMessage, type: "message" },
      { message: finalMessage, type: "message" },
    ]);
    state.settleActive(150);

    expect(state.viewFor(intermediate, 150)).toEqual({
      display: "summary",
      summary: {
        aborted: false,
        durationMs: 50,
        failedTools: 0,
        intermediateMessages: 1,
        outputApproximate: false,
        outputTokens: 38,
        running: false,
        tools: 1,
      },
    });
    expect(state.viewFor(tool, 150)?.display).toBe("hidden");
    expect(state.viewFor(finalAssistant, 150)?.display).toBe("original");
  });

  it("uses the final chained message replacement idempotently", () => {
    const state = new TurnFoldState();
    const intermediate = {};
    const finalAssistant = {};
    const first = assistantMessage(110, [{ id: "tool-1", name: "read", type: "toolCall" }], 20);
    const final = assistantMessage(140, [{ text: "hello", type: "text" }]);

    state.ensureActive(100);
    state.registerAssistantMessage(first);
    state.queueFinalAssistant(first);
    state.associateAssistant(intermediate, first);
    state.registerToolStart("tool-1", 115);
    state.registerAssistantMessage(final);
    state.queueFinalAssistant(final);
    state.queueFinalAssistant(final);
    const finalReplacement = assistantMessage(140, [{ text: "replaced", type: "text" }], 7);
    state.associateAssistant(finalAssistant, final);
    state.finalizeAssistantOutputs([
      { message: first, type: "message" },
      { message: finalReplacement, type: "message" },
    ]);
    state.settleActive(150);

    expect(state.viewFor(intermediate, 150)?.summary).toMatchObject({
      outputApproximate: false,
      outputTokens: 27,
    });
  });
});

describe("TurnFoldState views", () => {
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
      aborted: false,
      durationMs: 40,
      failedTools: 1,
      intermediateMessages: 1,
      outputApproximate: true,
      outputTokens: 6,
      running: false,
      tools: 1,
    });
    expect(state.viewFor(finalAssistant, 250)?.display).toBe("original");
  });
});

describe("TurnFoldState history", () => {
  it("collapses older settled turns above the latest three", () => {
    const state = new TurnFoldState();
    const firstMessage = assistantMessage(
      110,
      [
        { text: "one", type: "text" },
        { id: "tool-history", name: "read", type: "toolCall" },
      ],
      1,
    );
    const secondMessage = assistantMessage(210, [{ text: "two", type: "text" }], 2);
    const thirdMessage = assistantMessage(310, [{ text: "three", type: "text" }], 3);
    const fourthMessage = assistantMessage(410, [{ text: "four", type: "text" }], 4);
    const fifthMessage = assistantMessage(510, [{ text: "five", type: "text" }], 5);
    const firstComponent = {};
    const secondComponent = {};
    const thirdComponent = {};
    const fourthComponent = {};
    const fifthComponent = {};
    const entries = [
      { message: { content: "prompt 1", role: "user", timestamp: 100 }, type: "message" },
      { message: firstMessage, type: "message" },
      {
        message: {
          content: [{ text: "failed", type: "text" }],
          isError: true,
          role: "toolResult",
          timestamp: 120,
          toolCallId: "tool-history",
        },
        type: "message",
      },
      { message: { content: "prompt 2", role: "user", timestamp: 200 }, type: "message" },
      { message: secondMessage, type: "message" },
      { message: { content: "prompt 3", role: "user", timestamp: 300 }, type: "message" },
      { message: thirdMessage, type: "message" },
      { message: { content: "prompt 4", role: "user", timestamp: 400 }, type: "message" },
      { message: fourthMessage, type: "message" },
      { message: { content: "prompt 5", role: "user", timestamp: 500 }, type: "message" },
      { message: fifthMessage, type: "message" },
    ];

    state.loadHistory(entries);
    state.associateAssistant(firstComponent, firstMessage);
    state.associateAssistant(secondComponent, secondMessage);
    state.associateAssistant(thirdComponent, thirdMessage);
    state.associateAssistant(fourthComponent, fourthMessage);
    state.associateAssistant(fifthComponent, fifthMessage);

    expect(state.viewFor(firstComponent)).toMatchObject({
      display: "history",
      history: {
        failedTools: 1,
        messages: 2,
        outputApproximate: false,
        outputTokens: 3,
        tools: 1,
        turns: 2,
      },
    });
    expect(state.viewFor(secondComponent)?.display).toBe("hidden");
    expect(state.viewFor(thirdComponent)?.display).toBe("original");
    expect(state.viewFor(fifthComponent)?.display).toBe("original");

    state.setMode("expanded");
    expect(state.viewFor(firstComponent)?.display).toBe("original");
  });
});

describe("TurnFoldState view selection", () => {
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
      aborted: false,
      durationMs: 10,
      failedTools: 1,
      intermediateMessages: 0,
      outputApproximate: false,
      outputTokens: 0,
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

describe("aborted turn folding", () => {
  it("uses the aborted assistant as an anchor for the settled summary", () => {
    const state = new TurnFoldState();
    const assistant = {};
    const message = {
      ...assistantMessage(110, []),
      stopReason: "aborted",
    };

    state.ensureActive(100);
    state.registerAssistantMessage(message);
    state.queueFinalAssistant(message);
    state.associateAssistant(assistant, message);
    state.abortActive(150);
    state.finalizeAssistantOutputs([{ message, type: "message" }]);

    expect(state.viewFor(assistant, 150)).toEqual({
      display: "summary",
      summary: {
        aborted: true,
        durationMs: 50,
        failedTools: 0,
        intermediateMessages: 0,
        outputApproximate: false,
        outputTokens: 0,
        running: false,
        tools: 0,
      },
    });
  });

  it("reconstructs the abort summary from session history", () => {
    const state = new TurnFoldState();
    const assistant = {};
    const message = {
      ...assistantMessage(120, []),
      stopReason: "aborted",
    };

    state.loadHistory([
      { message: { content: "Start", role: "user", timestamp: 100 }, type: "message" },
      { message, type: "message" },
    ]);
    state.associateAssistant(assistant, message);

    expect(state.viewFor(assistant, 150)?.summary.aborted).toBe(true);
    expect(state.viewFor(assistant, 150)?.display).toBe("summary");
  });
});
