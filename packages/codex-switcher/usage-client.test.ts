import type { Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodexProfile } from "./config.ts";
import { createCodexUsageClient } from "./usage-client.ts";

const profile: CodexProfile = {
  id: "primary",
  label: "Primary",
  billing: "subscription-only",
  providerId: "openai-codex-primary",
};

function model(): Model<"openai-codex-responses"> {
  return {
    id: "gpt-test",
    name: "GPT test",
    api: "openai-codex-responses",
    provider: profile.providerId,
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
  it("queries with resolved auth, caches by fingerprint, and clears by profile", async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
      return Promise.resolve(usageResponse());
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createCodexUsageClient(300_000, 10_000, new Uint8Array(32));
    const signal = new AbortController().signal;
    const auth = { apiKey: "test-token" };

    const first = await client.query(profile, auth, model(), signal);
    const second = await client.query(profile, auth, model(), signal);
    expect(first).toBe(second);
    expect(first?.buckets[0]).toMatchObject({ remaining: 75 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    client.clear(profile);
    await client.query(profile, auth, model(), signal);
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
      profile,
      { headers: { authorization: "Bearer header-token" } },
      model(),
      new AbortController().signal,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("refreshes exhausted usage as soon as the reported reset time passes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(99_000);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(usageResponse(100, 100))
      .mockResolvedValueOnce(usageResponse(50, 200));
    vi.stubGlobal("fetch", fetchMock);
    const client = createCodexUsageClient(300_000, 10_000, new Uint8Array(32));
    const signal = new AbortController().signal;

    const exhausted = await client.query(profile, { apiKey: "test-token" }, model(), signal);
    expect(exhausted?.buckets[0]?.remaining).toBe(0);

    vi.setSystemTime(101_000);
    const reset = await client.query(profile, { apiKey: "test-token" }, model(), signal);
    expect(reset?.buckets[0]?.remaining).toBe(50);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns no report when request auth has no authorization value", async () => {
    const client = createCodexUsageClient(300_000, 10_000, new Uint8Array(32));
    await expect(
      client.query(profile, {}, model(), new AbortController().signal),
    ).resolves.toBeUndefined();
  });

  it("rejects a credential resolved for a custom endpoint", async () => {
    const client = createCodexUsageClient(300_000, 10_000, new Uint8Array(32));
    await expect(
      client.query(
        profile,
        { apiKey: "test-token", baseUrl: "https://proxy.example.test" },
        model(),
        new AbortController().signal,
      ),
    ).rejects.toThrow("custom endpoint credential");
  });
});
