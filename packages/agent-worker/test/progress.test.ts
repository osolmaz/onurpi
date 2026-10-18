import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@earendil-works/pi-durable";
import { progressOf } from "../src/agent.ts";

function thinkingDelta(): AgentEvent {
  return {
    type: "message_update",
    changes: [{ type: "thinking_delta", contentIndex: 0, delta: " " }],
    usage: { cost: { total: 0 }, tokens: { input: 0, output: 0 } },
  } as unknown as AgentEvent;
}

function textDelta(): AgentEvent {
  return {
    type: "message_update",
    changes: [{ type: "text_delta", contentIndex: 0, delta: " " }],
    usage: { cost: { total: 0 }, tokens: { input: 0, output: 0 } },
  } as unknown as AgentEvent;
}

function toolStart(name: string, args: Record<string, unknown>): AgentEvent {
  return {
    type: "tool_execution_start",
    toolName: name,
    args,
    toolCallId: "t1",
  } as unknown as AgentEvent;
}

function messageEnd(model: unknown): AgentEvent {
  return {
    type: "message_end",
    entry: { id: 1, conversationId: 1, kind: "message", model },
  } as unknown as AgentEvent;
}

describe("progressOf", () => {
  it("names the tool call the agent started", () => {
    expect(progressOf([toolStart("bash", { command: "git status" })])).toEqual("bash: git status");
  });

  it("names thinking and writing, with the newest state winning", () => {
    expect(progressOf([thinkingDelta()])).toEqual("Thinking");
    expect(progressOf([thinkingDelta(), textDelta()])).toEqual("Writing");
    expect(progressOf([textDelta(), toolStart("read", { path: "a.md" })])).toEqual("read: a.md");
  });

  it("uses a tool's single string argument and shortens long ones", () => {
    expect(progressOf([toolStart("bash", { command: "echo one\ntwo" })])).toEqual(
      "bash: echo one two",
    );
    const long = "x".repeat(200);
    const label = progressOf([toolStart("read", { path: long })]);
    expect(label?.length).toBeLessThanOrEqual("read: ".length + 96);
    expect(label?.endsWith("…")).toBe(true);
  });

  it("shows an intermediate answer's first line when a message ends", () => {
    const model = [
      {
        role: "assistant",
        content: [{ type: "text", text: "Checked the first source.\nNow the second." }],
      },
    ];
    expect(progressOf([messageEnd(model)])).toEqual("Checked the first source.");
  });

  it("ignores events with nothing to show", () => {
    expect(
      progressOf([{ type: "run_start", inputs: [] } as unknown as AgentEvent]),
    ).toBeUndefined();
    expect(
      progressOf([messageEnd([{ role: "user", content: [{ type: "text", text: "hi" }] }])]),
    ).toBeUndefined();
  });

  it("picks the last notable event of a batch", () => {
    expect(progressOf([toolStart("bash", { command: "one" }), textDelta()])).toEqual("Writing");
    expect(progressOf([textDelta(), toolStart("bash", { command: "one" })])).toEqual("bash: one");
  });
});
