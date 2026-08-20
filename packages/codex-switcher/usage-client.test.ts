import type { Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodexAccount } from "./config.ts";
import { createCodexUsageClient } from "./usage-client.ts";

const account: CodexAccount = { id: "primary", billing: "subscription-only" };

function model(): Model<"openai-codex-responses"> {
  return {
    id: "gpt-test",
    name: "GPT test",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
}

function usageResponse(usedPercent = 25, resetAt?: number): Response {
  return new Response(
    JSON.stringify({
      rate_limit: {
        primary_window: {
          used_percent: usedPercent,
          limit_window_seconds: 18_000,
          ...(resetAt === undefined ? {} : { reset_at: resetAt }),
        },
      },
      credits: { has_credits: false },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createCodexUsageClient", () => {
  it("queries with resolved auth, caches by account fingerprint, and clears by account", async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
      return Promise.resolve(usageResponse());
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createCodexUsageClient(300_000, 10_000, new Uint8Array(32));
    const signal = new AbortController().signal;
    const auth = { apiKey: "test-token" };

    const first = await client.query(account, auth, model(), signal);
    const second = await client.query(account, auth, model(), signal);
    expect(first).toBe(second);
    expect(first?.buckets[0]).toMatchObject({ remaining: 75 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    client.clear(account);
    await client.query(account, auth, model(), signal);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses an existing authorization header", async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer header-token");
      return Promise.resolve(usageResponse());
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createCodexUsageClient(300_000, 10_000, new Uint8Array(32));
    await client.query(
      account,
      { headers: { authorization: "Bearer header-token" } },
      model(),
      new AbortController().signal,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("refreshes exhausted usage when its factual reset time passes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(99_000);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(usageResponse(100, 100))
      .mockResolvedValueOnce(usageResponse(50, 200));
    vi.stubGlobal("fetch", fetchMock);
    const client = createCodexUsageClient(300_000, 10_000, new Uint8Array(32));
    const signal = new AbortController().signal;

    expect(
      (await client.query(account, { apiKey: "test-token" }, model(), signal))?.buckets[0]
        ?.remaining,
    ).toBe(0);
    vi.setSystemTime(101_000);
    expect(
      (await client.query(account, { apiKey: "test-token" }, model(), signal))?.buckets[0]
        ?.remaining,
    ).toBe(50);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns no report without authorization and rejects custom endpoints", async () => {
    const client = createCodexUsageClient(300_000, 10_000, new Uint8Array(32));
    const signal = new AbortController().signal;
    await expect(client.query(account, {}, model(), signal)).resolves.toBeUndefined();
    await expect(
      client.query(
        account,
        { apiKey: "test-token", baseUrl: "https://proxy.example.test" },
        model(),
        signal,
      ),
    ).rejects.toThrow("custom endpoint credential");
  });
});
