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
  overrides: Partial<AssistantMessage> = {},
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
      ...overrides,
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

describe("function call pairing", () => {
  /** Every function_call_output must follow an earlier function_call with the same call_id. */
  function expectOutputsMatchEarlierCalls(input: ResponseItem[]): void {
    const seenCalls = new Set<string>();
    for (const item of input) {
      const callId = item["call_id"];
      if (item.type === "function_call") {
        if (typeof callId === "string") seenCalls.add(callId);
        continue;
      }
      if (item.type === "function_call_output") {
        expect(typeof callId).toBe("string");
        expect(seenCalls.has(callId as string)).toBe(true);
      }
    }
  }

  it("pairs every tool result with an earlier matching function call", () => {
    const branch = branchOf(
      userEntry("u1", "inspect the repo"),
      assistantEntry("a1", [
        { type: "toolCall", id: "call_1|fc_1", name: "read", arguments: { path: "a.ts" } },
      ]),
      toolResultEntry("t1", "call_1|fc_1", [{ type: "text", text: "file contents" }]),
      assistantEntry("a2", [
        { type: "toolCall", id: "call_2|fc_2", name: "edit", arguments: { path: "a.ts" } },
      ]),
      toolResultEntry("t2", "call_2|fc_2", [{ type: "text", text: "edited" }]),
      userEntry("u2", "thanks"),
    );
    const input = effectiveInputForBranch({ branch, model: model(), tools: [] });
    expect(input.filter((item) => item.type === "function_call_output")).toHaveLength(2);
    expectOutputsMatchEarlierCalls(input);
  });

  it("pairs synthesized outputs for orphaned tool calls", () => {
    const branch = branchOf(
      assistantEntry("a1", [
        { type: "toolCall", id: "call_1|fc_1", name: "read", arguments: { path: "a.ts" } },
      ]),
      userEntry("u1", "stop and explain"),
    );
    const input = effectiveInputForBranch({ branch, model: model(), tools: [] });
    expectOutputsMatchEarlierCalls(input);
  });

  it("pairs tool results that follow a native checkpoint", () => {
    const checkpoint: SessionEntry = {
      type: "compaction",
      id: "compact-1",
      parentId: "u1",
      timestamp: new Date().toISOString(),
      summary: "marker",
      firstKeptEntryId: "u1",
      tokensBefore: 100,
      details: {
        kind: "openai-codex-native-compaction",
        version: 1,
        modelKey: "openai-codex:openai-codex-responses:gpt-test",
        replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }],
      },
    };
    const branch = branchOf(
      userEntry("u1", "start"),
      checkpoint,
      assistantEntry("a1", [
        { type: "toolCall", id: "call_1|fc_1", name: "read", arguments: { path: "a.ts" } },
      ]),
      toolResultEntry("t1", "call_1|fc_1", [{ type: "text", text: "file contents" }]),
    );
    const input = effectiveInputForBranch({ branch, model: model(), tools: [] });
    expectOutputsMatchEarlierCalls(input);
  });

  it("drops tool calls from aborted assistant messages instead of emitting unpaired items", () => {
    const branch = branchOf(
      userEntry("u1", "start"),
      assistantEntry(
        "a1",
        [{ type: "toolCall", id: "call_1|fc_1", name: "edit", arguments: {} }],
        "aborted",
      ),
      userEntry("u2", "what happened?"),
    );
    const input = effectiveInputForBranch({ branch, model: model(), tools: [] });
    expect(JSON.stringify(input)).not.toContain("call_1");
    expectOutputsMatchEarlierCalls(input);
  });
});

describe("cross-provider sanitization", () => {
  it("drops foreign reasoning state and response item ids", () => {
    const foreign = assistantEntry(
      "a1",
      [
        {
          type: "thinking",
          thinking: "checking",
          thinkingSignature: JSON.stringify({
            type: "reasoning",
            id: "rs_grok_1",
            status: "completed",
            summary: [{ type: "summary_text", text: "checking" }],
            encrypted_content: "opaque-grok-state",
          }),
        },
        {
          type: "text",
          text: "Looks good.",
          textSignature: JSON.stringify({ v: 1, id: "msg_grok_1" }),
        },
        {
          type: "toolCall",
          id: "call_grok_1|fc_grok_1",
          name: "bash",
          arguments: { command: "git status" },
        },
      ],
      "toolUse",
      { provider: "xai", api: "openai-responses", model: "grok-4.6" },
    );
    const branch = branchOf(userEntry("u1", "review this change"), foreign);
    const input = effectiveInputForBranch({ branch, model: model(), tools: [] });

    expect(input.find((item) => item.type === "reasoning")).toBeUndefined();
    expect(JSON.stringify(input)).not.toContain("opaque-grok-state");
    const assistantMessage = input.find(
      (item) => item.type === "message" && item["role"] === "assistant",
    );
    expect(assistantMessage?.["id"]).toBe("msg_pi_1");
    expect(assistantMessage?.["status"]).toBeUndefined();
    const functionCall = input.find((item) => item.type === "function_call");
    expect(functionCall?.["call_id"]).toBe("call_grok_1");
    expect(functionCall?.["id"]).toBeUndefined();
  });

  it("removes response-only status from replayed Codex reasoning", () => {
    const branch = branchOf(
      userEntry("u1", "continue"),
      assistantEntry("a1", [
        {
          type: "thinking",
          thinking: "checking",
          thinkingSignature: JSON.stringify({
            type: "reasoning",
            id: "rs_codex_1",
            status: "completed",
            summary: [],
            encrypted_content: "opaque-codex-state",
          }),
        },
      ]),
    );
    const input = effectiveInputForBranch({ branch, model: model(), tools: [] });
    const reasoning = input.find((item) => item.type === "reasoning");
    expect(reasoning?.["status"]).toBeUndefined();
    expect(reasoning?.["encrypted_content"]).toBe("opaque-codex-state");
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
