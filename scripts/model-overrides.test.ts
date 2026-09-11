import { describe, expect, it } from "vitest";
import {
  applyModelOverrides,
  extractModelOverrides,
  isModelOverrides,
  isRecord,
} from "./model-overrides.ts";

const LIVE = {
  providers: {
    "llama-server": {
      baseUrl: "http://127.0.0.1:8080/v1",
      apiKey: "local",
      models: [{ id: "qwen3.6-35b-a3b" }],
    },
    modelbest: {
      baseUrl: "https://api.modelbest.cn/v1",
      apiKey: "$MODELBEST_API_KEY",
    },
    huggingface: {
      modelOverrides: {
        "deepseek-ai/DeepSeek-V4.1-Flash": { contextWindow: 272000 },
      },
    },
  },
};

describe("isRecord", () => {
  it("accepts plain objects and rejects everything else", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("text")).toBe(false);
    expect(isRecord(7)).toBe(false);
  });
});

describe("extractModelOverrides", () => {
  it("keeps only the per-model overrides", () => {
    expect(extractModelOverrides(LIVE)).toEqual({
      providers: {
        huggingface: {
          modelOverrides: { "deepseek-ai/DeepSeek-V4.1-Flash": { contextWindow: 272000 } },
        },
      },
    });
  });

  it("never copies endpoints or credentials", () => {
    const serialized = JSON.stringify(extractModelOverrides(LIVE));
    expect(serialized).not.toContain("127.0.0.1");
    expect(serialized).not.toContain("MODELBEST_API_KEY");
    expect(serialized).not.toContain("baseUrl");
    expect(serialized).not.toContain("qwen3.6-35b-a3b");
  });

  it("skips providers without overrides, with empty overrides, and with non-object entries", () => {
    expect(
      extractModelOverrides({
        providers: { a: { models: [] }, b: { modelOverrides: {} }, c: "nope", d: null },
      }),
    ).toEqual({ providers: {} });
  });

  it("returns an empty result for a missing or malformed file", () => {
    expect(extractModelOverrides(undefined)).toEqual({ providers: {} });
    expect(extractModelOverrides({})).toEqual({ providers: {} });
    expect(extractModelOverrides({ providers: "nope" })).toEqual({ providers: {} });
  });
});

describe("applyModelOverrides", () => {
  it("adds overrides while preserving providers, endpoints, and models", () => {
    const applied = applyModelOverrides(LIVE, {
      providers: { huggingface: { modelOverrides: { "other/model": { contextWindow: 128000 } } } },
    });

    expect(applied["providers"]).toEqual({
      "llama-server": LIVE.providers["llama-server"],
      modelbest: LIVE.providers.modelbest,
      huggingface: { modelOverrides: { "other/model": { contextWindow: 128000 } } },
    });
  });

  it("creates a provider that does not exist yet", () => {
    const applied = applyModelOverrides(
      { providers: {} },
      {
        providers: {
          anthropic: { modelOverrides: { "claude-opus-4-5": { contextWindow: 200000 } } },
        },
      },
    );

    expect(applied["providers"]).toEqual({
      anthropic: { modelOverrides: { "claude-opus-4-5": { contextWindow: 200000 } } },
    });
  });

  it("keeps unrelated top-level keys", () => {
    const applied = applyModelOverrides({ providers: {}, somethingElse: 1 }, { providers: {} });
    expect(applied["somethingElse"]).toBe(1);
  });

  it("tolerates a file with no providers key", () => {
    expect(applyModelOverrides({}, { providers: {} })).toEqual({ providers: {} });
  });

  it("rejects a non-object live file", () => {
    expect(() => applyModelOverrides([], { providers: {} }, "models.json")).toThrow(
      /No object in models\.json/,
    );
  });
});

describe("isModelOverrides", () => {
  it("accepts a well-formed document", () => {
    expect(isModelOverrides({ providers: { a: { modelOverrides: {} } } })).toBe(true);
    expect(isModelOverrides({ providers: {} })).toBe(true);
  });

  it("rejects malformed documents", () => {
    expect(isModelOverrides({})).toBe(false);
    expect(isModelOverrides({ providers: "nope" })).toBe(false);
    expect(isModelOverrides({ providers: { a: {} } })).toBe(false);
    expect(isModelOverrides({ providers: { a: { modelOverrides: 1 } } })).toBe(false);
    expect(isModelOverrides(null)).toBe(false);
  });
});
