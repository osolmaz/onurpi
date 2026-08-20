import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import {
  assertOfficialCodexEndpoint,
  isCodexFamilyModel,
  isCodexFamilyProvider,
  isCodexProfileProvider,
  mapCodexEventProvider,
  toBuiltInCodexContext,
  toBuiltInCodexModel,
} from "./codex-family.ts";

function model(provider = "openai-codex-primary"): Model<"openai-codex-responses"> {
  return {
    id: "gpt-test",
    name: "GPT test",
    api: "openai-codex-responses",
    provider,
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
}

function assistant(provider = "openai-codex-primary"): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-codex-responses",
    provider,
    model: "gpt-test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  };
}

describe("Codex family predicates", () => {
  it.each(["openai-codex", "openai-codex-primary", "openai-codex-work-two"])(
    "accepts %s",
    (provider) => {
      expect(isCodexFamilyProvider(provider)).toBe(true);
    },
  );
  it.each([undefined, "openai", "openai-codex-"])("rejects %s", (provider) => {
    expect(isCodexProfileProvider(provider)).toBe(false);
  });
  it("requires the Codex API", () => {
    expect(isCodexFamilyModel(model())).toBe(true);
    expect(isCodexFamilyModel({ ...model(), api: "openai-responses" })).toBe(false);
  });
});

describe("assertOfficialCodexEndpoint", () => {
  it.each(["https://chatgpt.com/backend-api", "https://chatgpt.com/backend-api/"])(
    "accepts the official endpoint %s",
    (baseUrl) => {
      expect(() => {
        assertOfficialCodexEndpoint({ baseUrl });
      }).not.toThrow();
    },
  );

  it.each([
    "https://example.com/backend-api",
    "https://chatgpt.com.example.com/backend-api",
    "http://chatgpt.com/backend-api",
    "https://user@chatgpt.com/backend-api",
    "https://chatgpt.com/backend-api?redirect=1",
    "https://chatgpt.com/other",
    "not a URL",
  ])("rejects non-official endpoint %s", (baseUrl) => {
    expect(() => {
      assertOfficialCodexEndpoint({ baseUrl });
    }).toThrow("Codex profile authentication is restricted");
  });
});

it("maps models, history, and events through the built-in provider", () => {
  expect(toBuiltInCodexModel(model()).provider).toBe("openai-codex");
  const user = { role: "user" as const, content: "hello", timestamp: 1 };
  const context = toBuiltInCodexContext({ messages: [assistant(), user] });
  expect(context.messages[0]).toMatchObject({ provider: "openai-codex" });
  expect(context.messages[1]).toBe(user);
  const event = mapCodexEventProvider(
    { type: "done", reason: "stop", message: assistant("openai-codex") },
    "openai-codex-backup",
  );
  expect(event).toMatchObject({ message: { provider: "openai-codex-backup" } });
});
