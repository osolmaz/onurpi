import { describe, expect, test } from "vitest";

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

import {
  capProviderModels,
  capWindowForCeiling,
  DEFAULT_RESERVE_TOKENS,
  type CatalogModel,
} from "./cap.ts";

function chatConfig(config: ProviderModelConfig | undefined) {
  return config?.type === "chat" ? config : undefined;
}

function chatModel(overrides: Partial<CatalogModel> = {}): CatalogModel {
  return {
    type: "chat",
    id: "big-model",
    name: "Big Model",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://api.example.com",
    input: ["text", "image"],
    inputLimits: { maxRequestBytes: 1000 },
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    headers: { "x-custom": "yes" },
    reasoning: true,
    thinkingLevelMap: { high: "high" },
    promptCache: { short: 300 },
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    samplingParams: { temperature: 1 },
    samplingParamsByThinkingLevel: { off: { temperature: 0 } },
    compat: { supportsStore: true },
    ...overrides,
  };
}

describe("capWindowForCeiling", () => {
  test("adds Pi's compaction reserve so the threshold lands on the ceiling", () => {
    expect(capWindowForCeiling(272_000)).toBe(272_000 + DEFAULT_RESERVE_TOKENS);
  });

  test("accepts an explicit reserve", () => {
    expect(capWindowForCeiling(272_000, 32_000)).toBe(304_000);
  });
});

describe("capProviderModels", () => {
  test("returns undefined when no chat model exceeds the cap", () => {
    const models = [chatModel({ contextWindow: 200_000 })];
    expect(capProviderModels(models, 288_384)).toBeUndefined();
  });

  test("caps only over-cap chat models and reports their ids", () => {
    const models = [
      chatModel({ id: "big", contextWindow: 1_000_000 }),
      chatModel({ id: "small", contextWindow: 200_000 }),
    ];
    const plan = capProviderModels(models, 288_384);
    expect(plan?.cappedIds).toEqual(["big"]);
    expect(plan?.configs).toHaveLength(2);
    const big = plan?.configs.find((config) => config.id === "big");
    const small = plan?.configs.find((config) => config.id === "small");
    expect(chatConfig(big)?.contextWindow).toBe(288_384);
    expect(chatConfig(small)?.contextWindow).toBe(200_000);
  });

  test("keeps chat fields needed by the provider config and drops registry extras", () => {
    const plan = capProviderModels([chatModel()], 288_384);
    const chat = chatConfig(plan?.configs[0]);
    if (!chat) throw new Error("expected a capped chat config");
    expect(chat).toMatchObject({
      type: "chat",
      id: "big-model",
      name: "Big Model",
      api: "anthropic-messages",
      baseUrl: "https://api.example.com",
      input: ["text", "image"],
      reasoning: true,
      contextWindow: 288_384,
      maxTokens: 64_000,
    });
    expect(chat.cost).toEqual({
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    });
    expect(chat.thinkingLevelMap).toEqual({ high: "high" });
    expect(chat.compat).toEqual({ supportsStore: true });
    expect(chat.samplingParams).toEqual({ temperature: 1 });
    expect(chat.promptCache).toEqual({ short: 300 });
    expect(chat.inputLimits).toEqual({ maxRequestBytes: 1000 });
    expect(chat.headers).toEqual({ "x-custom": "yes" });
    const record = plan?.configs[0] as unknown as Record<string, unknown>;
    expect("provider" in record).toBe(false);
  });

  test("deep-clones nested objects so configs do not alias registry state", () => {
    const model = chatModel();
    const plan = capProviderModels([model], 288_384);
    const cost = model.cost as { input: number };
    cost.input = 99;
    (model.inputLimits as { maxRequestBytes: number }).maxRequestBytes = 42;
    expect(chatConfig(plan?.configs[0])?.cost.input).toBe(3);
    expect(chatConfig(plan?.configs[0])?.inputLimits?.maxRequestBytes).toBe(1000);
  });

  test("treats models without an explicit type as chat models", () => {
    const legacy = chatModel();
    delete legacy.type;
    const plan = capProviderModels([legacy], 288_384);
    expect(plan?.cappedIds).toEqual(["big-model"]);
    expect(plan?.configs[0]?.type).toBe("chat");
  });

  test("passes image and classifier models through untouched", () => {
    const chat = chatModel();
    const image: CatalogModel = {
      type: "image",
      id: "image-1",
      name: "Image",
      api: "openai-images",
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      output: ["text", "image"],
    };
    const classifier: CatalogModel = {
      type: "classifier",
      id: "classifier-1",
      name: "Classifier",
      api: "openai-classifiers",
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 500_000,
    };
    const plan = capProviderModels([chat, image, classifier], 288_384);
    expect(plan?.cappedIds).toEqual(["big-model"]);
    expect(plan?.configs[0]).toMatchObject({ type: "chat", id: "big-model" });
    expect(plan?.configs[1]).toMatchObject({ type: "image", id: "image-1" });
    expect(plan?.configs[2]).toMatchObject({ type: "classifier", id: "classifier-1" });
  });

  test("re-deriving from the same originals lets the cap move in both directions", () => {
    const models = [chatModel({ contextWindow: 1_000_000 })];
    const low = capProviderModels(models, 288_384);
    const high = capProviderModels(models, 416_384);
    expect(chatConfig(low?.configs[0])?.contextWindow).toBe(288_384);
    expect(chatConfig(high?.configs[0])?.contextWindow).toBe(416_384);
  });
});
