import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type {
  CompactionEntry,
  CustomEntry,
  SessionMessageEntry,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
  findNativeCheckpoint,
  isOpenAICodexModel,
  modelKey,
  NATIVE_COMPACTION_KIND,
  NATIVE_COMPACTION_VERSION,
  parseNativeCompactionDetails,
  type NativeCompactionDetails,
  type ResponseItem,
} from "./native-checkpoint.ts";
import {
  buildCompactionRequestBody,
  buildReplacementHistory,
  buildToolPayload,
  effectiveInputForBranch,
  retainRecentUserMessages,
  stripInputFromPayload,
} from "./responses-input.ts";
import { MODEL_KEY, userEntry } from "./test-fakes.ts";

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

function validDetails(encrypted: string, key = MODEL_KEY): NativeCompactionDetails {
  return {
    kind: NATIVE_COMPACTION_KIND,
    version: NATIVE_COMPACTION_VERSION,
    modelKey: key,
    replacementHistory: [
      { role: "user", content: [{ type: "input_text", text: "old user fact" }] },
      { type: "compaction", encrypted_content: encrypted },
    ],
  };
}

function nativeEntry(id: string, details: unknown): CompactionEntry {
  return {
    type: "compaction",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    summary: "marker",
    firstKeptEntryId: "user-1",
    tokensBefore: 100,
    details,
  };
}

describe("isOpenAICodexModel / modelKey", () => {
  it("matches only the built-in Codex provider and API", () => {
    expect(isOpenAICodexModel(model())).toBe(true);
    expect(isOpenAICodexModel(model({ provider: "custom-codex" }))).toBe(false);
    expect(isOpenAICodexModel(model({ api: "openai-responses" }))).toBe(false);
    expect(isOpenAICodexModel(undefined)).toBe(false);
    expect(isOpenAICodexModel({})).toBe(false);
    expect(modelKey(model())).toBe(MODEL_KEY);
  });
});

describe("parseNativeCompactionDetails", () => {
  it("accepts a well-formed payload", () => {
    const parsed = parseNativeCompactionDetails(validDetails("opaque"));
    expect(parsed?.replacementHistory.at(-1)).toEqual({
      type: "compaction",
      encrypted_content: "opaque",
    });
  });

  it("rejects malformed payloads", () => {
    const base = validDetails("opaque") as unknown as Record<string, unknown>;
    const cases: unknown[] = [
      undefined,
      {},
      { ...base, kind: "other" },
      { ...base, version: 2 },
      { ...base, modelKey: 42 },
      { ...base, replacementHistory: [] },
      { ...base, replacementHistory: ["not-an-item"] },
      {
        ...base,
        replacementHistory: [
          { type: "compaction", encrypted_content: "a" },
          { type: "compaction", encrypted_content: "b" },
        ],
      },
      { ...base, replacementHistory: [{ type: "compaction" }] },
      {
        ...base,
        replacementHistory: [
          { type: "compaction", encrypted_content: "a" },
          { role: "user", content: "trailing user item after the compaction item" },
        ],
      },
    ];
    for (const value of cases) {
      expect(parseNativeCompactionDetails(value)).toBeUndefined();
    }
  });
});

describe("findNativeCheckpoint", () => {
  it("returns none for an empty branch or a plain text compaction", () => {
    expect(findNativeCheckpoint([]).status).toBe("none");
    const plain = nativeEntry("plain", { readFiles: [] });
    expect(findNativeCheckpoint([plain]).status).toBe("none");
  });

  it("finds a valid checkpoint and flags malformed payloads as invalid", () => {
    const valid = findNativeCheckpoint([nativeEntry("n", validDetails("opaque"))]);
    expect(valid.status).toBe("valid");
    expect(findNativeCheckpoint([nativeEntry("n", { kind: NATIVE_COMPACTION_KIND })]).status).toBe(
      "invalid",
    );
  });

  it("supports legacy custom checkpoint entries", () => {
    const custom: CustomEntry = {
      type: "custom",
      id: "checkpoint",
      parentId: null,
      timestamp: new Date().toISOString(),
      customType: NATIVE_COMPACTION_KIND,
      data: validDetails("opaque"),
    };
    expect(findNativeCheckpoint([custom]).status).toBe("valid");
  });

  it("treats the newest compaction-like entry as authoritative", () => {
    const native = nativeEntry("native", validDetails("opaque"));
    const plainAfter: CompactionEntry = { ...nativeEntry("local", {}), id: "local" };
    expect(findNativeCheckpoint([native, plainAfter]).status).toBe("none");
  });
});

describe("effectiveInputForBranch", () => {
  it("repeated compaction replaces rather than nests the old opaque item", () => {
    const firstUser = userEntry("user-1", "old user fact");
    const checkpoint = nativeEntry("compact-1", validDetails("opaque-1"));
    const nextUser = { ...userEntry("user-2", "new user fact"), parentId: "compact-1" };
    const input = effectiveInputForBranch({
      branch: [firstUser, checkpoint, nextUser],
      model: model(),
      tools: [],
    });
    expect(input.filter((item) => item.type === "compaction")).toHaveLength(1);

    const replacement = buildReplacementHistory(input, {
      type: "compaction",
      encrypted_content: "opaque-2",
    });
    expect(replacement.filter((item) => item.type === "compaction")).toEqual([
      { type: "compaction", encrypted_content: "opaque-2" },
    ]);
    expect(JSON.stringify(replacement)).toContain("new user fact");
  });

  it("throws for malformed and model-mismatched checkpoints", () => {
    const malformed = nativeEntry("compact-1", {
      kind: NATIVE_COMPACTION_KIND,
      version: NATIVE_COMPACTION_VERSION,
      modelKey: MODEL_KEY,
      replacementHistory: [],
    });
    expect(() =>
      effectiveInputForBranch({ branch: [malformed], model: model(), tools: [] }),
    ).toThrowError(/malformed/);

    const mismatched = nativeEntry(
      "compact-1",
      validDetails("opaque", "openai-codex:openai-codex-responses:other-model"),
    );
    expect(() =>
      effectiveInputForBranch({ branch: [mismatched], model: model(), tools: [] }),
    ).toThrowError(/different model/);
  });

  it("overflow recovery excludes the failed assistant response", () => {
    const user = userEntry("user-1", "large request");
    const failure = {
      ...assistantEntry(
        "assistant-error",
        [{ type: "text", text: "context window exceeded" }],
        "error",
      ),
      parentId: "user-1",
    };
    const input = effectiveInputForBranch({
      branch: [user, failure],
      model: model(),
      tools: [],
      excludeLastAssistantError: true,
    });
    expect(JSON.stringify(input)).not.toContain("context window exceeded");
    expect(JSON.stringify(input)).toContain("large request");
  });

  it("does not replay partial tool calls from an aborted assistant after a checkpoint", () => {
    const checkpoint: CustomEntry = {
      type: "custom",
      id: "checkpoint",
      parentId: null,
      timestamp: new Date().toISOString(),
      customType: NATIVE_COMPACTION_KIND,
      data: {
        kind: NATIVE_COMPACTION_KIND,
        version: NATIVE_COMPACTION_VERSION,
        modelKey: MODEL_KEY,
        replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }],
      },
    };
    const aborted = {
      ...assistantEntry(
        "assistant-aborted",
        [{ type: "toolCall", id: "call-aborted|fc_aborted", name: "edit", arguments: {} }],
        "aborted",
      ),
      parentId: "checkpoint",
    };
    const user = {
      ...userEntry("user-after-abort", "what happened?"),
      parentId: "assistant-aborted",
    };

    const input = effectiveInputForBranch({
      branch: [checkpoint, aborted, user],
      model: model(),
      tools: [],
    });
    expect(JSON.stringify(input)).not.toContain("call-aborted");
    expect(JSON.stringify(input)).toContain("what happened?");
  });

  it("synthesizes outputs for non-aborted orphaned tool calls", () => {
    const assistant = assistantEntry(
      "assistant-tool",
      [{ type: "toolCall", id: "call-orphan|fc_orphan", name: "edit", arguments: {} }],
      "toolUse",
    );
    const user = { ...userEntry("user-after-tool", "interrupt"), parentId: "assistant-tool" };

    const input = effectiveInputForBranch({ branch: [assistant, user], model: model(), tools: [] });
    expect(input).toContainEqual({
      type: "function_call_output",
      call_id: "call-orphan",
      output: "No result provided",
    });
  });
});

describe("replacement history retention", () => {
  it("retains only recent user messages before the opaque item", () => {
    const input: ResponseItem[] = [
      { type: "message", role: "user", content: [{ type: "input_text", text: "old" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "reply" }] },
      { type: "function_call", call_id: "call-1" },
      { type: "message", role: "user", content: [{ type: "input_text", text: "new" }] },
    ];
    const retained = retainRecentUserMessages(input);
    expect(retained).toHaveLength(2);
    expect(retained.every((item) => item["role"] === "user")).toBe(true);

    const replacement = buildReplacementHistory(input, {
      type: "compaction",
      encrypted_content: "opaque",
    });
    expect(replacement.at(-1)).toEqual({ type: "compaction", encrypted_content: "opaque" });
  });

  it("rejects a compaction item without encrypted content", () => {
    expect(() => buildReplacementHistory([], { type: "compaction" })).toThrowError(
      /valid compaction item/,
    );
  });
});

describe("request body", () => {
  it("builds a compaction request from a cached payload shape", () => {
    const body = buildCompactionRequestBody({
      basePayload: {
        model: "old",
        input: [{ role: "user", content: "stale" }],
        messages: [1],
        previous_response_id: "resp_1",
        tools: [{ stale: true }],
        include: ["reasoning.encrypted_content"],
        text: { verbosity: "high" },
        reasoning: { effort: "high" },
      },
      model: model(),
      input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
      instructions: "You are Codex.",
      tools: [{ type: "function", name: "read" }],
      sessionId: "session-1",
    });

    expect(body).toMatchObject({
      model: "gpt-test",
      store: false,
      stream: true,
      instructions: "You are Codex.",
      tool_choice: "auto",
      parallel_tool_calls: true,
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: "session-1",
      text: { verbosity: "high" },
      reasoning: { effort: "high" },
    });
    expect(body["messages"]).toBeUndefined();
    expect(body["previous_response_id"]).toBeUndefined();
    expect((body["input"] as unknown[]).at(-1)).toEqual({ type: "compaction_trigger" });
    expect(body["tools"]).toEqual([{ type: "function", name: "read" }]);
    expect(JSON.stringify(body)).not.toContain("stale");
  });

  it("defaults verbosity and drops tools when none are active", () => {
    const body = buildCompactionRequestBody({
      model: model(),
      input: [],
      instructions: "You are Codex.",
      sessionId: "session-1",
    });
    expect(body["text"]).toEqual({ verbosity: "low" });
    expect(body["tools"]).toBeUndefined();
    expect(body["include"]).toEqual(["reasoning.encrypted_content"]);
  });

  it("strips replayed fields from cached payload shapes", () => {
    const stripped = stripInputFromPayload({
      input: [1],
      messages: [2],
      previous_response_id: "resp",
      model: "gpt-test",
    });
    expect(stripped).toEqual({ model: "gpt-test" });
  });
});

function toolInfo(name: string): ToolInfo {
  return {
    name,
    description: `${name} a file`,
    parameters: { type: "object" },
    sourceInfo: {
      path: `/tools/${name}.ts`,
      source: "test",
      scope: "temporary",
      origin: "top-level",
    },
  };
}

describe("buildToolPayload", () => {
  it("keeps only active tools as function definitions", () => {
    const tools = buildToolPayload([toolInfo("read"), toolInfo("edit")], ["read"]);
    expect(tools).toEqual([
      {
        type: "function",
        name: "read",
        description: "read a file",
        parameters: { type: "object" },
        strict: null,
      },
    ]);
    expect(buildToolPayload([], [])).toBeUndefined();
  });
});
