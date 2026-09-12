import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEndEvent, ExtensionAPI, InputEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const agentDir = vi.hoisted(() => ({ path: "" }));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => agentDir.path,
}));

const { default: claudishlint } = await import("./index.ts");

const RESET_TYPE = "claudishlint.reset";
const NUDGE_TYPE = "claudishlint.nudge";

// Trips three rules at once: `never-chain` and `vocab-stance`.
const CLAUDISH_TEXT =
  "The wire-up is honest and real, and it never scans, never fails, never stalls. " +
  "It is a real change with a real payoff for a real team that ships real work every real week.";

const CLEAN_TEXT = "The build finished. Run the tests next.";

type Handler = (...arguments_: unknown[]) => unknown;

type BranchEntry = { type: string; customType?: string; data?: unknown };

function harness(): {
  appendEntry: ReturnType<typeof vi.fn>;
  branch: BranchEntry[];
  handlers: Map<string, Handler>;
  pi: ExtensionAPI;
  sendUserMessage: ReturnType<typeof vi.fn>;
} {
  const handlers = new Map<string, Handler>();
  const appendEntry = vi.fn();
  const sendUserMessage = vi.fn();
  const branch: BranchEntry[] = [];
  const pi = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
    appendEntry,
    sendUserMessage,
  } as unknown as ExtensionAPI;
  return { appendEntry, branch, handlers, pi, sendUserMessage };
}

function handler(handlers: Map<string, Handler>, event: string): Handler {
  const found = handlers.get(event);
  if (!found) {
    throw new Error(`no handler registered for ${event}`);
  }
  return found;
}

function agentEndContext(branch: BranchEntry[]): unknown {
  return { sessionManager: { getBranch: () => branch } };
}

function agentEndEvent(...texts: string[]): AgentEndEvent {
  return {
    messages: texts.map((text) => ({
      role: "assistant",
      content: [{ type: "text", text }],
    })),
  } as unknown as AgentEndEvent;
}

describe("claudishlint extension", () => {
  beforeEach(() => {
    agentDir.path = mkdtempSync(join(tmpdir(), "claudishlint-test-"));
  });

  afterEach(() => {
    rmSync(agentDir.path, { recursive: true, force: true });
  });

  it("registers an input and an agent_end handler", () => {
    const { handlers, pi } = harness();
    claudishlint(pi);
    expect([...handlers.keys()].sort()).toEqual(["agent_end", "input"]);
  });

  it("marks the start of an interaction on user input", () => {
    const { appendEntry, handlers, pi } = harness();
    claudishlint(pi);
    handler(handlers, "input")({ source: "interactive", text: "hi" } as InputEvent);
    expect(appendEntry).toHaveBeenCalledWith(RESET_TYPE, true);
  });

  it("ignores input that the extension itself sent", () => {
    const { appendEntry, handlers, pi } = harness();
    claudishlint(pi);
    handler(handlers, "input")({ source: "extension" } as unknown as InputEvent);
    expect(appendEntry).not.toHaveBeenCalled();
  });

  it("asks for a full rewrite when a dense response trips a rule", () => {
    const { appendEntry, branch, handlers, pi, sendUserMessage } = harness();
    claudishlint(pi);
    handler(handlers, "agent_end")(agentEndEvent(CLAUDISH_TEXT), agentEndContext(branch));
    expect(appendEntry).toHaveBeenCalledWith(NUDGE_TYPE, true);
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    const [prompt, options] = sendUserMessage.mock.calls[0] as [string, { deliverAs: string }];
    expect(options).toEqual({ deliverAs: "followUp" });
    expect(prompt).toContain("Simple Language Style Guide");
    expect(prompt).toContain("Pattern: ");
    expect(prompt).toContain("Never X, never Y");
  });

  it("leaves a plain response alone", () => {
    const { appendEntry, branch, handlers, pi, sendUserMessage } = harness();
    claudishlint(pi);
    handler(handlers, "agent_end")(agentEndEvent(CLEAN_TEXT), agentEndContext(branch));
    expect(appendEntry).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("nudges at most once per interaction", () => {
    const { handlers, pi, sendUserMessage } = harness();
    claudishlint(pi);
    const branch: BranchEntry[] = [
      { type: "custom", customType: RESET_TYPE, data: true },
      { type: "custom", customType: NUDGE_TYPE, data: true },
    ];
    handler(handlers, "agent_end")(agentEndEvent(CLAUDISH_TEXT), agentEndContext(branch));
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("points back to the style guide on a later interaction", () => {
    const { handlers, pi, sendUserMessage } = harness();
    claudishlint(pi);
    const branch: BranchEntry[] = [
      { type: "custom", customType: NUDGE_TYPE, data: true },
      { type: "custom", customType: RESET_TYPE, data: true },
    ];
    handler(handlers, "agent_end")(agentEndEvent(CLAUDISH_TEXT), agentEndContext(branch));
    const [prompt] = sendUserMessage.mock.calls[0] as [string];
    expect(prompt).toContain("rewritten following the Simple Language Style Guide.");
    expect(prompt).not.toContain("keep every fact");
  });

  it("does nothing when the turn has no assistant message", () => {
    const { handlers, pi, sendUserMessage } = harness();
    claudishlint(pi);
    const event = { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };
    handler(handlers, "agent_end")(event as unknown as AgentEndEvent, agentEndContext([]));
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("never reads the config when the turn has no assistant message", () => {
    const { handlers, pi } = harness();
    claudishlint(pi);
    writeFileSync(join(agentDir.path, ".claudishlint.json"), "not json");
    const event = { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };
    expect(() =>
      handler(handlers, "agent_end")(event as unknown as AgentEndEvent, agentEndContext([])),
    ).not.toThrow();
  });

  it("honours the strictness setting from the agent config file", () => {
    const { handlers, pi, sendUserMessage } = harness();
    claudishlint(pi);
    writeFileSync(join(agentDir.path, ".claudishlint.json"), '{"strictness":0}');
    handler(handlers, "agent_end")(agentEndEvent(CLAUDISH_TEXT), agentEndContext([]));
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("fails on a config file that is not valid JSON", () => {
    const { handlers, pi } = harness();
    claudishlint(pi);
    writeFileSync(join(agentDir.path, ".claudishlint.json"), "not json");
    expect(() =>
      handler(handlers, "agent_end")(agentEndEvent(CLAUDISH_TEXT), agentEndContext([])),
    ).toThrow(/is not valid JSON/);
  });

  it("fails on a config value of the wrong shape instead of dropping the gate", () => {
    const { handlers, pi } = harness();
    claudishlint(pi);
    writeFileSync(join(agentDir.path, ".claudishlint.json"), '{"strictness": false}');
    expect(() =>
      handler(handlers, "agent_end")(agentEndEvent(CLAUDISH_TEXT), agentEndContext([])),
    ).toThrow(/needs a strictness from 0 to 1/);
  });

  it("keeps the gate on when a config file holds null", () => {
    const { handlers, pi, sendUserMessage } = harness();
    claudishlint(pi);
    writeFileSync(join(agentDir.path, ".claudishlint.json"), "null");
    expect(() =>
      handler(handlers, "agent_end")(agentEndEvent(CLAUDISH_TEXT), agentEndContext([])),
    ).toThrow(/must hold a JSON object/);
    expect(sendUserMessage).not.toHaveBeenCalled();
  });
});
