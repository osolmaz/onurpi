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

describe("isContinuationPrompt", () => {
  it.each(["continue", "Continue please", "go on", "keep going", "you decide", "do it now"])(
    "classifies %s as continuation",
    (prompt) => {
      expect(isContinuationPrompt(prompt)).toBe(true);
    },
  );

  it.each(["continue with a proof", "check the tests", "use a different method", ""])(
    "classifies %s as substantive",
    (prompt) => {
      expect(isContinuationPrompt(prompt)).toBe(false);
    },
  );
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
