import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ConversationView, EntryRecord } from "@earendil-works/pi-durable";
import { ConversationViewBridge } from "../src/view-events.ts";

function view(
  options: {
    entries?: readonly EntryRecord[];
    live?: Record<string, unknown>;
  } = {},
): ConversationView {
  return {
    conversation: { id: 1 } as ConversationView["conversation"],
    entries: options.entries ?? [],
    docs: (options.live === undefined
      ? {}
      : { "pi.live": options.live }) as ConversationView["docs"],
  };
}

function entry(id: number, model: readonly { readonly role: string }[]): EntryRecord {
  return { conversationId: 1, id, kind: "message", model } as unknown as EntryRecord;
}

function assistant(text: string, thinking = ""): AssistantMessage {
  return {
    content: [
      ...(thinking.length === 0 ? [] : [{ thinking, type: "thinking" }]),
      { text, type: "text" },
    ],
    role: "assistant",
  } as unknown as AssistantMessage;
}

function types(events: readonly { readonly type: string }[]): string[] {
  return events.map((event) => event.type);
}

describe("ConversationViewBridge", () => {
  it("reports a run boundary once for the live run", () => {
    const bridge = new ConversationViewBridge();
    expect(types(bridge.diff(view({ live: { run: { turns: 0 } } })))).toEqual(["run_start"]);
    expect(bridge.diff(view({ live: { run: { turns: 0 } } }))).toEqual([]);
    expect(types(bridge.diff(view()))).toEqual(["run_end"]);
  });

  it("reports each transcript entry once, closing a turn before an answer", () => {
    const bridge = new ConversationViewBridge();
    const first = view({ entries: [entry(1, [{ role: "user" }])] });
    expect(types(bridge.diff(first))).toEqual(["message_end"]);
    expect(bridge.diff(first)).toEqual([]);

    const second = view({ entries: [entry(1, [{ role: "user" }]), entry(2, [assistant("hi")])] });
    expect(types(bridge.diff(second))).toEqual(["turn_end", "message_end"]);
  });

  it("ends a tool call that produced a result entry", () => {
    const bridge = new ConversationViewBridge();
    const entries = [entry(1, [{ role: "toolResult" }])];
    expect(types(bridge.diff(view({ entries })))).toEqual(["message_end", "tool_execution_end"]);
  });

  it("streams only the reasoning a generation added", () => {
    const bridge = new ConversationViewBridge();
    const partial = (thinking: string) =>
      view({ live: { generation: { attempt: 1, message: assistant("", thinking) } } });

    expect(types(bridge.diff(partial("")))).toEqual(["thinking_start"]);
    expect(bridge.diff(partial("we "))).toEqual([{ delta: "we ", type: "thinking_delta" }]);
    expect(bridge.diff(partial("we need "))).toEqual([{ delta: "need ", type: "thinking_delta" }]);
    expect(bridge.diff(partial("we need "))).toEqual([]);
  });

  it("starts a new reasoning block for the next attempt", () => {
    const bridge = new ConversationViewBridge();
    const attempt = (value: number, thinking: string) =>
      view({ live: { generation: { attempt: value, message: assistant("", thinking) } } });
    expect(types(bridge.diff(attempt(1, "first ")))).toEqual(["thinking_start"]);
    expect(types(bridge.diff(attempt(2, "second ")))).toEqual(["thinking_start"]);
  });

  it("reports the answer once and labels a tool call with its arguments", () => {
    const bridge = new ConversationViewBridge();
    const message = {
      content: [
        { arguments: { command: "git status" }, id: "call-1", name: "bash", type: "toolCall" },
        { text: "running it", type: "text" },
      ],
      role: "assistant",
    } as unknown as AssistantMessage;
    const live = {
      generation: { attempt: 1, message },
      tools: [{ callId: "call-1", name: "bash" }],
    };
    const events = bridge.diff(view({ live }));
    expect(types(events)).toEqual(["tool_execution_start", "thinking_start"]);
    expect(events).toContainEqual({
      args: { command: "git status" },
      toolName: "bash",
      type: "tool_execution_start",
    });
    expect(types(bridge.diff(view({ live })))).toEqual([]);
  });
});
