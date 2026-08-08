import type { Api, AssistantMessage, Model, ToolResultMessage } from "@earendil-works/pi-ai";
import type { SessionEntry, SessionMessageEntry, ToolInfo } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import type { ResponseItem } from "./native-checkpoint.ts";
import {
  buildToolPayload,
  effectiveInputForBranch,
  retainRecentUserMessages,
} from "./responses-input.ts";
import { userEntry } from "./test-fakes.ts";

function model(overrides: Partial<Model<Api>> = {}): Model<Api> {
  return {
    id: "gpt-test",
    name: "GPT Test",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text"],
    contextWindow: 200_000,
    maxTokens: 16_384,
    cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 },
    ...overrides,
  };
}

function assistantEntry(
  id: string,
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): SessionMessageEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content,
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "gpt-test",
      stopReason,
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now(),
    },
  };
}

function toolResultEntry(
  id: string,
  toolCallId: string,
  content: ToolResultMessage["content"],
  addedToolNames?: string[],
): SessionMessageEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "toolResult",
      toolCallId,
      toolName: "read",
      content,
      isError: false,
      ...(addedToolNames ? { addedToolNames } : {}),
      timestamp: Date.now(),
    },
  };
}

/** Link entries into a parent chain so buildSessionContext sees the whole branch. */
function branchOf(...entries: SessionEntry[]): SessionEntry[] {
  return entries.map((entry, index) => ({
    ...entry,
    parentId: index === 0 ? null : (entries[index - 1]?.id ?? null),
  }));
}

describe("Responses conversion", () => {
  it("converts string user messages and image parts", () => {
    const branch = branchOf(
      {
        ...userEntry("u1", ""),
        message: { role: "user" as const, content: "plain string", timestamp: 1 },
      },
      {
        ...userEntry("u2", ""),
        message: {
          role: "user" as const,
          content: [
            { type: "text" as const, text: "look at this" },
            { type: "image" as const, data: "aW1hZ2U=", mimeType: "image/png" },
          ],
          timestamp: 2,
        },
      },
    );
    const input = effectiveInputForBranch({ branch, model: model(), tools: [] });
    expect(input).toContainEqual({
      role: "user",
      content: [{ type: "input_text", text: "plain string" }],
    });
    expect(JSON.stringify(input)).toContain("data:image/png;base64,aW1hZ2U=");
  });

  it("replays reasoning, text signatures, and tool calls", () => {
    const reasoning = JSON.stringify({ type: "reasoning", id: "rs_1", summary: [] });
    const branch = branchOf(
      assistantEntry("a1", [
        { type: "thinking", thinking: "hmm", thinkingSignature: reasoning },
        { type: "thinking", thinking: "broken", thinkingSignature: "{not json" },
        { type: "thinking", thinking: "plain" },
        {
          type: "text",
          text: "first",
          textSignature: JSON.stringify({ id: "msg_a", phase: "commentary" }),
        },
        { type: "text", text: "second", textSignature: "plain-id" },
        { type: "text", text: "third" },
        {
          type: "toolCall",
          id: "call_1|fc_item1",
          name: "read",
          arguments: { path: "a.ts" },
        },
      ]),
      toolResultEntry("t1", "call_1|fc_item1", [{ type: "text", text: "file contents" }]),
      userEntry("u1", "thanks"),
    );
    const input = effectiveInputForBranch({ branch, model: model(), tools: [] });

    expect(input).toContainEqual({ type: "reasoning", id: "rs_1", summary: [] });
    expect(input).toContainEqual({
      type: "message",
      role: "assistant",
      id: "msg_a",
      status: "completed",
      content: [{ type: "output_text", text: "first", annotations: [] }],
      phase: "commentary",
    });
    expect(input).toContainEqual(
      expect.objectContaining({ type: "message", id: "plain-id" }) as Record<string, unknown>,
    );
    expect(input).toContainEqual(
      expect.objectContaining({ type: "message", id: "msg_pi_0_2" }) as Record<string, unknown>,
    );
    expect(input).toContainEqual({
      type: "function_call",
      call_id: "call_1",
      id: "fc_item1",
      name: "read",
      arguments: JSON.stringify({ path: "a.ts" }),
    });
    expect(input).toContainEqual({
      type: "function_call_output",
      call_id: "call_1",
      output: "file contents",
    });
    expect(JSON.stringify(input)).not.toContain("broken");
  });

  it("hashes over-long signature ids down to the Responses limit", () => {
    const longId = `msg_${"x".repeat(100)}`;
    const branch = branchOf(
      assistantEntry("a1", [{ type: "text", text: "hi", textSignature: longId }]),
    );
    const input = effectiveInputForBranch({ branch, model: model(), tools: [] });
    const message = input.find((item) => item.type === "message");
    expect(String(message?.["id"])).toMatch(/^msg_[0-9a-f]{16}$/);
  });

  it("emits tool search items for deferred tools", () => {
    const tool: ToolInfo = {
      name: "deferred_tool",
      description: "Loaded later",
      parameters: { type: "object" },
      sourceInfo: {
        path: "/tools/deferred.ts",
        source: "test",
        scope: "temporary",
        origin: "top-level",
      },
    };
    const branch = branchOf(
      assistantEntry("a1", [
        { type: "toolCall", id: "call_1", name: "tool_search", arguments: {} },
      ]),
      toolResultEntry("t1", "call_1", [{ type: "text", text: "ok" }], ["deferred_tool"]),
    );
    const input = effectiveInputForBranch({ branch, model: model(), tools: [tool] });

    const searchCall = input.find((item) => item.type === "tool_search_call");
    const searchOutput = input.find((item) => item.type === "tool_search_output");
    expect(searchCall?.["call_id"]).toMatch(/^pi_tool_load_/);
    expect(searchOutput?.["tools"]).toEqual([
      expect.objectContaining({ type: "function", name: "deferred_tool", defer_loading: true }),
    ]);
  });

  it("handles image tool results according to model capabilities", () => {
    const images = [{ type: "image" as const, data: "aW1hZ2U=", mimeType: "image/png" }];
    const textless = effectiveInputForBranch({
      branch: branchOf(
        assistantEntry("a1", [{ type: "toolCall", id: "call_1", name: "shot", arguments: {} }]),
        toolResultEntry("t1", "call_1", images),
      ),
      model: model(),
      tools: [],
    });
    expect(textless).toContainEqual({
      type: "function_call_output",
      call_id: "call_1",
      output: "(see attached image)",
    });

    const withImages = effectiveInputForBranch({
      branch: branchOf(
        assistantEntry("a1", [{ type: "toolCall", id: "call_1", name: "shot", arguments: {} }]),
        toolResultEntry("t1", "call_1", images),
      ),
      model: model({ input: ["text", "image"] }),
      tools: [],
    });
    const output = withImages.find((item) => item.type === "function_call_output");
    expect(JSON.stringify(output)).toContain("data:image/png;base64,aW1hZ2U=");
  });

  it("labels empty tool results", () => {
    const input = effectiveInputForBranch({
      branch: branchOf(
        assistantEntry("a1", [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }]),
        toolResultEntry("t1", "call_1", []),
      ),
      model: model(),
      tools: [],
    });
    expect(input).toContainEqual({
      type: "function_call_output",
      call_id: "call_1",
      output: "(no tool output)",
    });
  });
});

describe("retention truncation", () => {
  it("truncates the newest oversized user message to the remaining budget", () => {
    const longText = "y".repeat(400);
    const items: ResponseItem[] = [
      { role: "user", content: "x".repeat(400) },
      { role: "user", content: [{ type: "input_text", text: longText }] },
    ];
    const retained = retainRecentUserMessages(items, 10);
    expect(retained).toHaveLength(1);
    const text = JSON.stringify(retained[0]);
    expect(text).toContain("…");
    expect(text.length).toBeLessThan(120);
  });

  it("keeps a message whose content is neither string nor array", () => {
    const items: ResponseItem[] = [{ type: "message", role: "user", content: 42 }];
    // A non-textual user message is not retained at all.
    expect(retainRecentUserMessages(items, 10)).toEqual([]);
  });

  it("truncates older messages into the remaining budget", () => {
    const items: ResponseItem[] = [
      { role: "user", content: "first" },
      { role: "user", content: "second" },
      { role: "user", content: "third" },
    ];
    const retained = retainRecentUserMessages(items, 3);
    // The older message is truncated into the remaining token budget.
    expect(retained.map((item) => item["content"])).toEqual(["se…d", "third"]);
  });
});

describe("tool payload", () => {
  it("orders tools by the registry order, not the active list", () => {
    const tools = buildToolPayload(
      [
        {
          name: "b",
          description: "B",
          parameters: {},
          sourceInfo: { path: "/b", source: "t", scope: "temporary", origin: "top-level" },
        },
        {
          name: "a",
          description: "A",
          parameters: {},
          sourceInfo: { path: "/a", source: "t", scope: "temporary", origin: "top-level" },
        },
      ],
      ["a", "b"],
    );
    expect(tools?.map((tool) => tool["name"])).toEqual(["b", "a"]);
  });
});
