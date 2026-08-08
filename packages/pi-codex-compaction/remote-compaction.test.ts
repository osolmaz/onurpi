import type { Api, Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildCodexHeaders,
  callRemoteCompaction,
  extractCodexAccountId,
  mergeFeatureHeader,
  REMOTE_COMPACTION_FEATURE,
  resolveCodexResponsesUrl,
} from "./remote-compaction.ts";
import { compactionSse, FAKE_ACCOUNT_ID, makeToken } from "./test-fakes.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function model(): Model<Api> {
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
  };
}

describe("resolveCodexResponsesUrl", () => {
  it("defaults to the official ChatGPT backend", () => {
    expect(resolveCodexResponsesUrl(undefined)).toBe(
      "https://chatgpt.com/backend-api/codex/responses",
    );
    expect(resolveCodexResponsesUrl("   ")).toBe("https://chatgpt.com/backend-api/codex/responses");
  });

  it("normalizes official base URLs", () => {
    expect(resolveCodexResponsesUrl("https://chatgpt.com/backend-api/")).toBe(
      "https://chatgpt.com/backend-api/codex/responses",
    );
    expect(resolveCodexResponsesUrl("https://chatgpt.com/backend-api/codex")).toBe(
      "https://chatgpt.com/backend-api/codex/responses",
    );
    expect(resolveCodexResponsesUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/codex/responses",
    );
  });

  it("rejects non-official endpoints before any credential is attached", () => {
    const rejected = [
      "https://proxy.example.test",
      "http://chatgpt.com/backend-api",
      "https://chatgpt.com.evil.example",
      "https://chatgpt.com:8443/backend-api",
      "https://user:pw@chatgpt.com/backend-api",
      "not a url",
    ];
    for (const baseUrl of rejected) {
      expect(() => resolveCodexResponsesUrl(baseUrl)).toThrowError(/Codex/);
    }
  });
});

describe("extractCodexAccountId", () => {
  it("extracts the account id from a structurally valid token", () => {
    expect(extractCodexAccountId(makeToken())).toBe(FAKE_ACCOUNT_ID);
  });

  it("fails without echoing token material", () => {
    const secretish = "opaque.secret-body.signature";
    let message = "";
    try {
      extractCodexAccountId(secretish);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("Failed to extract");
    expect(message).not.toContain("secret-body");
  });
});

describe("mergeFeatureHeader", () => {
  it("merges without dropping existing features", () => {
    expect(mergeFeatureHeader("foo, remote_compaction_v2")).toBe("foo,remote_compaction_v2");
    expect(mergeFeatureHeader(undefined)).toBe(REMOTE_COMPACTION_FEATURE);
    expect(mergeFeatureHeader("")).toBe(REMOTE_COMPACTION_FEATURE);
  });
});

describe("buildCodexHeaders", () => {
  it("sets auth, account, and feature headers", () => {
    const headers = buildCodexHeaders({
      apiKey: makeToken(),
      headers: { "x-codex-beta-features": "other_feature", "x-removed": null },
      sessionId: "session-1",
    });
    expect(headers.get("authorization")).toBe(`Bearer ${makeToken()}`);
    expect(headers.get("chatgpt-account-id")).toBe(FAKE_ACCOUNT_ID);
    expect(headers.get("x-codex-beta-features")).toBe("other_feature,remote_compaction_v2");
    expect(headers.get("session-id")).toBe("session-1");
    expect(headers.has("x-removed")).toBe(false);
  });
});

describe("callRemoteCompaction", () => {
  it("parses the compaction item and usage from the SSE stream", async () => {
    const result = await callRemoteCompaction({
      url: "https://chatgpt.com/backend-api/codex/responses",
      headers: new Headers(),
      body: { input: [] },
      model: model(),
      fetchImpl: (() => Promise.resolve(compactionSse("opaque-1"))) as typeof fetch,
    });
    expect(result.compactionItem).toEqual({
      type: "compaction",
      id: "cmp_1",
      encrypted_content: "opaque-1",
    });
    expect(result.usage?.totalTokens).toBe(110);
  });

  it("retries retryable HTTP failures and honors retry-after-ms", async () => {
    let attempts = 0;
    const fetchImpl = (() => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.resolve(
          new Response("slow down", { status: 429, headers: { "retry-after-ms": "0" } }),
        );
      }
      return Promise.resolve(compactionSse("after-retry"));
    }) as typeof fetch;
    const result = await callRemoteCompaction({
      url: "https://chatgpt.com/backend-api/codex/responses",
      headers: new Headers(),
      body: { input: [] },
      model: model(),
      fetchImpl,
    });
    expect(attempts).toBe(2);
    expect(result.compactionItem["encrypted_content"]).toBe("after-retry");
  });

  it("fails closed on non-retryable HTTP errors", async () => {
    let attempts = 0;
    const fetchImpl = (() => {
      attempts += 1;
      return Promise.resolve(new Response("nope", { status: 400 }));
    }) as typeof fetch;
    await expect(
      callRemoteCompaction({
        url: "https://chatgpt.com/backend-api/codex/responses",
        headers: new Headers(),
        body: { input: [] },
        model: model(),
        fetchImpl,
      }),
    ).rejects.toThrowError(/failed \(400\)/);
    expect(attempts).toBe(1);
  });

  it("rejects a stream without a completed response", async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(
          `data: ${JSON.stringify({ type: "response.output_item.done", item: {} })}\n\n`,
          {
            status: 200,
          },
        ),
      )) as typeof fetch;
    await expect(
      callRemoteCompaction({
        url: "https://chatgpt.com/backend-api/codex/responses",
        headers: new Headers(),
        body: { input: [] },
        model: model(),
        fetchImpl,
      }),
    ).rejects.toThrowError(/closed before response\.completed/);
  });

  it("rejects malformed SSE data", async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response("data: {not json\n\n", { status: 200 }))) as typeof fetch;
    await expect(
      callRemoteCompaction({
        url: "https://chatgpt.com/backend-api/codex/responses",
        headers: new Headers(),
        body: { input: [] },
        model: model(),
        fetchImpl,
      }),
    ).rejects.toThrowError(/malformed compaction SSE data/);
  });

  it("propagates aborts without retrying", async () => {
    const controller = new AbortController();
    controller.abort();
    let attempts = 0;
    const fetchImpl = (() => {
      attempts += 1;
      return Promise.resolve(new Response("teapot", { status: 418 }));
    }) as typeof fetch;
    await expect(
      callRemoteCompaction({
        url: "https://chatgpt.com/backend-api/codex/responses",
        headers: new Headers(),
        body: { input: [] },
        model: model(),
        signal: controller.signal,
        fetchImpl,
      }),
    ).rejects.toThrowError(/failed \(418\)/);
    expect(attempts).toBe(1);
  });
});
