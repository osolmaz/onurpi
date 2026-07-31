import { createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LOOP_GUARD_EVENT, LOOP_GUARD_MESSAGE_TYPE } from "./intervention-message.ts";
import { isContinuationPrompt, LoopGuardController } from "./loop-guard-controller.ts";

type SentMessage = {
  message: {
    content: string;
    customType: string;
    details?: unknown;
    display: boolean;
  };
  options:
    | {
        deliverAs?: "followUp" | "nextTurn" | "steer";
        triggerTurn?: boolean;
      }
    | undefined;
};

function createHarness(options: { idle?: boolean; pending?: boolean; sendFails?: boolean } = {}) {
  const sent: SentMessage[] = [];
  const emitted: unknown[] = [];
  const events = createEventBus();
  events.on(LOOP_GUARD_EVENT, (event) => emitted.push(event));
  const runtime: Pick<ExtensionAPI, "events" | "sendMessage"> = {
    events,
    sendMessage(message, messageOptions) {
      if (options.sendFails === true) throw new Error("delivery failed");
      sent.push({
        message: {
          content:
            typeof message.content === "string" ? message.content : JSON.stringify(message.content),
          customType: message.customType,
          details: message.details,
          display: message.display,
        },
        options: messageOptions,
      });
    },
  };
  const abort = vi.fn();
  const notify = vi.fn();
  const setStatus = vi.fn();
  const ctx = {
    abort,
    hasPendingMessages: () => options.pending ?? false,
    isIdle: () => options.idle ?? true,
    ui: { notify, setStatus },
  };
  return {
    abort,
    controller: new LoopGuardController(runtime),
    ctx,
    emitted,
    notify,
    sent,
    setStatus,
  };
}

function assistantTurn(command: string, result: string) {
  return {
    message: {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          id: `call-${command}`,
          name: "exec_command",
          arguments: { cmd: command },
        },
      ],
    },
    toolResults: [
      {
        role: "toolResult",
        toolCallId: `call-${command}`,
        toolName: "exec_command",
        isError: false,
        content: [{ type: "text", text: result }],
      },
    ],
  };
}

function settledEpisode(
  harness: ReturnType<typeof createHarness>,
  command: string,
  result: string,
  prompt = "continue",
): void {
  harness.controller.input({ source: "interactive", text: prompt }, harness.ctx);
  harness.controller.agentStart();
  const turn = assistantTurn(command, result);
  harness.controller.turnEnd(turn, harness.ctx);
  harness.controller.agentEnd({ messages: [turn.message, ...turn.toolResults] });
  harness.controller.agentSettled(harness.ctx);
}

function repeatedThinking(prefix: string): string {
  const passage = Array.from({ length: 176 }, (_, index) => `${prefix}${String(index)}`).join(" ");
  return `${passage} ${passage} ${passage}`;
}

function streamThinking(
  harness: ReturnType<typeof createHarness>,
  thinking: string,
  chunkSize = thinking.length,
): void {
  harness.controller.messageStart({ message: { role: "assistant" } });
  for (let offset = 0; offset < thinking.length; offset += chunkSize) {
    harness.controller.messageUpdate(
      {
        assistantMessageEvent: {
          delta: thinking.slice(offset, offset + chunkSize),
          type: "thinking_delta",
        },
      },
      harness.ctx,
    );
  }
  harness.controller.messageUpdate(
    { assistantMessageEvent: { type: "thinking_end" } },
    harness.ctx,
  );
}

describe("isContinuationPrompt", () => {
  it.each([
    "continue",
    "Continue please",
    "go on",
    "keep going",
    "you decide",
    "you choose",
    "do it now",
    "continue, you choose",
    "please continue and you decide now",
    "go ahead, then proceed",
  ])("classifies %s as continuation", (prompt) => {
    expect(isContinuationPrompt(prompt)).toBe(true);
  });

  it.each([
    "continue with a proof",
    "continue and",
    "continue, choose problem 488",
    "you choose the next test",
    "check the tests",
    "use a different method",
    "",
  ])("classifies %s as substantive", (prompt) => {
    expect(isContinuationPrompt(prompt)).toBe(false);
  });
});

describe("LoopGuardController", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("does nothing while disabled", () => {
    const harness = createHarness();
    for (let index = 0; index < 10; index += 1) {
      settledEpisode(harness, "python scan.py", "same");
    }
    expect(harness.sent).toEqual([]);
    expect(harness.emitted).toEqual([]);
    expect(harness.controller.state).toBe("off");
  });

  it("sends one visible follow-up after an exact settled-run cycle", () => {
    const harness = createHarness();
    harness.controller.enable(harness.ctx);
    for (let index = 0; index < 3; index += 1) {
      settledEpisode(harness, "python scan.py", "same");
    }

    expect(harness.controller.state).toBe("nudged");
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]?.message.customType).toBe(LOOP_GUARD_MESSAGE_TYPE);
    expect(harness.sent[0]?.message.display).toBe(true);
    expect(harness.sent[0]?.options).toEqual({ deliverAs: "followUp", triggerTurn: true });
    expect(harness.emitted).toMatchObject([
      { action: "nudge", decision: { kind: "exact_cycle" }, version: 1 },
    ]);
  });

  it("trips safely when the intervention cannot be delivered", () => {
    const harness = createHarness({ sendFails: true });
    harness.controller.enable(harness.ctx);
    for (let index = 0; index < 3; index += 1) {
      settledEpisode(harness, "python scan.py", "same");
    }

    expect(harness.controller.state).toBe("tripped");
    expect(harness.sent).toEqual([]);
    expect(harness.emitted).toMatchObject([{ action: "trip" }]);
  });

  it("does not start a duplicate turn when another extension has pending work", () => {
    const harness = createHarness({ pending: true });
    harness.controller.enable(harness.ctx);
    for (let index = 0; index < 3; index += 1) {
      settledEpisode(harness, "python scan.py", "same");
    }
    expect(harness.sent[0]?.options).toEqual({ deliverAs: "followUp", triggerTurn: false });
  });

  it("catches sanitized Bob-style continuation churn", () => {
    const harness = createHarness();
    harness.controller.enable(harness.ctx);
    for (const position of [60, 70, 80, 90]) {
      settledEpisode(
        harness,
        `python3 subset_scan.py --position ${String(position)} --cap ${String(position * 1_000_000)}`,
        `position ${String(position)} produced a different measurement`,
      );
    }

    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]?.message.content).toContain("continuation-led runs");
  });

  it("does not fuzzy-match materially directed experiments", () => {
    const harness = createHarness();
    harness.controller.enable(harness.ctx);
    for (const prompt of [
      "test position 60",
      "now test a different algorithm",
      "inspect the proof",
      "run the formatter",
    ]) {
      settledEpisode(harness, "python scan.py --position 60", prompt, prompt);
    }
    expect(harness.sent).toEqual([]);
  });

  it("retains settled history for compound continuation prompts", () => {
    const harness = createHarness();
    harness.controller.enable(harness.ctx);
    for (let index = 0; index < 3; index += 1) {
      settledEpisode(harness, "python scan.py", "same", "continue, you choose");
    }

    expect(harness.sent).toHaveLength(1);
    expect(harness.emitted).toMatchObject([{ action: "nudge", decision: { kind: "exact_cycle" } }]);
  });

  it("trips instead of sending a second automatic message", () => {
    const harness = createHarness();
    harness.controller.enable(harness.ctx);
    for (let round = 0; round < 2; round += 1) {
      for (let index = 0; index < 3; index += 1) {
        settledEpisode(harness, "python scan.py", "same");
      }
    }

    expect(harness.controller.state).toBe("tripped");
    expect(harness.sent).toHaveLength(1);
    expect(harness.emitted).toMatchObject([{ action: "nudge" }, { action: "trip" }]);
  });
});

describe("LoopGuardController streamed thinking", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("aborts repeated thinking and delivers one correction only after settlement", () => {
    const harness = createHarness();
    harness.controller.enable(harness.ctx);
    harness.controller.agentStart();

    streamThinking(harness, repeatedThinking("density"), 7);

    expect(harness.abort).toHaveBeenCalledOnce();
    expect(harness.controller.state).toBe("nudged");
    expect(harness.sent).toEqual([]);
    expect(harness.emitted).toMatchObject([
      { action: "nudge", decision: { kind: "thinking_repetition" }, version: 1 },
    ]);

    harness.controller.agentSettled(harness.ctx);

    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]?.message.customType).toBe(LOOP_GUARD_MESSAGE_TYPE);
    expect(harness.sent[0]?.message.content).toContain("reasoning windows");
    expect(harness.sent[0]?.options).toEqual({
      deliverAs: "followUp",
      triggerTurn: true,
    });
  });

  it("trips and aborts without a second correction on repeated streamed thinking", () => {
    const harness = createHarness();
    harness.controller.enable(harness.ctx);
    harness.controller.agentStart();
    streamThinking(harness, repeatedThinking("first"), 31);
    harness.controller.agentSettled(harness.ctx);

    harness.controller.agentStart();
    streamThinking(harness, repeatedThinking("second"), 29);

    expect(harness.abort).toHaveBeenCalledTimes(2);
    expect(harness.controller.state).toBe("tripped");
    expect(harness.sent).toHaveLength(1);
    expect(harness.emitted).toMatchObject([{ action: "nudge" }, { action: "trip" }]);
  });

  it("trips safely if the delayed correction cannot be delivered", () => {
    const harness = createHarness({ sendFails: true });
    harness.controller.enable(harness.ctx);
    harness.controller.agentStart();
    streamThinking(harness, repeatedThinking("delivery"));

    harness.controller.agentSettled(harness.ctx);

    expect(harness.abort).toHaveBeenCalledOnce();
    expect(harness.controller.state).toBe("tripped");
    expect(harness.sent).toEqual([]);
    expect(harness.emitted).toMatchObject([{ action: "nudge" }, { action: "trip" }]);
  });

  it("ignores repeated visible answer text", () => {
    const harness = createHarness();
    harness.controller.enable(harness.ctx);
    harness.controller.agentStart();
    harness.controller.messageStart({ message: { role: "assistant" } });
    harness.controller.messageUpdate(
      {
        assistantMessageEvent: {
          delta: repeatedThinking("answer"),
          type: "text_delta",
        },
      },
      harness.ctx,
    );

    expect(harness.abort).not.toHaveBeenCalled();
    expect(harness.controller.state).toBe("armed");
  });

  it("clears partial stream evidence after substantive direction", () => {
    const harness = createHarness({ idle: false });
    const passage = Array.from({ length: 176 }, (_, index) => `partial${String(index)}`).join(" ");
    harness.controller.enable(harness.ctx);
    harness.controller.agentStart();
    streamThinking(harness, `${passage} ${passage}`);

    harness.controller.input(
      {
        source: "interactive",
        streamingBehavior: "steer",
        text: "stop and prove a different lemma",
      },
      harness.ctx,
    );
    streamThinking(harness, passage);

    expect(harness.abort).not.toHaveBeenCalled();
    expect(harness.controller.state).toBe("armed");
    expect(harness.sent).toEqual([]);
  });

  it("drops a pending correction when the session shuts down", () => {
    const harness = createHarness();
    harness.controller.enable(harness.ctx);
    harness.controller.agentStart();
    streamThinking(harness, repeatedThinking("shutdown"));
    expect(harness.abort).toHaveBeenCalledOnce();

    harness.controller.sessionShutdown(harness.ctx);
    harness.controller.agentSettled(harness.ctx);

    expect(harness.controller.state).toBe("off");
    expect(harness.sent).toEqual([]);
  });
});

describe("LoopGuardController active runs", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("steers an active twelve-turn run and suppresses duplicate settled detection", () => {
    const harness = createHarness({ idle: false });
    harness.controller.enable(harness.ctx);
    harness.controller.agentStart();
    for (let index = 0; index < 12; index += 1) {
      harness.controller.turnEnd(
        assistantTurn("python scan.py", `result-${String(index)}`),
        harness.ctx,
      );
    }

    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]?.options).toEqual({ deliverAs: "steer" });
    harness.controller.agentSettled(harness.ctx);
    expect(harness.sent).toHaveLength(1);
    expect(harness.controller.state).toBe("nudged");
  });

  it("aborts an active run after a second detection", () => {
    const harness = createHarness({ idle: false });
    harness.controller.enable(harness.ctx);
    harness.controller.manualNudge(harness.ctx);
    harness.controller.agentStart();
    for (let index = 0; index < 12; index += 1) {
      harness.controller.turnEnd(assistantTurn("python scan.py", "same"), harness.ctx);
    }

    expect(harness.controller.state).toBe("tripped");
    expect(harness.sent).toHaveLength(1);
    expect(harness.abort).toHaveBeenCalledOnce();
  });

  it("restarts collection at the next turn after streamed substantive direction", () => {
    const harness = createHarness({ idle: false });
    harness.controller.enable(harness.ctx);
    harness.controller.agentStart();
    for (let index = 0; index < 11; index += 1) {
      harness.controller.turnEnd(
        assistantTurn("python old.py", `old-${String(index)}`),
        harness.ctx,
      );
    }

    harness.controller.input(
      {
        source: "interactive",
        streamingBehavior: "steer",
        text: "stop measuring and use a different proof",
      },
      harness.ctx,
    );
    harness.controller.turnEnd(assistantTurn("python old.py", "old-final"), harness.ctx);
    expect(harness.sent).toEqual([]);

    harness.controller.turnStart();
    for (let index = 0; index < 12; index += 1) {
      harness.controller.turnEnd(
        assistantTurn("python new.py", `new-${String(index)}`),
        harness.ctx,
      );
    }
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]?.options).toEqual({ deliverAs: "steer" });
  });

  it("starts a fresh armed epoch on substantive user direction", () => {
    const harness = createHarness();
    harness.controller.enable(harness.ctx);
    harness.controller.manualNudge(harness.ctx);
    expect(harness.controller.state).toBe("nudged");

    harness.controller.input(
      { source: "interactive", text: "stop measuring and prove the lemma" },
      harness.ctx,
    );
    expect(harness.controller.state).toBe("armed");
  });

  it("ignores extension-originated input for epoch resets", () => {
    const harness = createHarness();
    harness.controller.enable(harness.ctx);
    harness.controller.manualNudge(harness.ctx);
    harness.controller.input({ source: "extension", text: "a different instruction" }, harness.ctx);
    expect(harness.controller.state).toBe("nudged");
  });

  it("clears all behavior and UI status during shutdown", () => {
    const harness = createHarness();
    harness.controller.enable(harness.ctx);
    harness.controller.sessionShutdown(harness.ctx);

    expect(harness.controller.state).toBe("off");
    expect(harness.setStatus).toHaveBeenLastCalledWith("loop-guard", undefined);
  });

  it("requires enablement before reset or manual nudge", () => {
    const harness = createHarness();
    harness.controller.reset(harness.ctx);
    harness.controller.manualNudge(harness.ctx);

    expect(harness.sent).toEqual([]);
    expect(harness.notify).toHaveBeenCalledTimes(2);
  });
});
