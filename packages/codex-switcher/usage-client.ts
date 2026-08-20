import { randomBytes } from "node:crypto";

import type { AuthResult, Model } from "@earendil-works/pi-ai";
import {
  adapterForProvider,
  fingerprintResolvedAuth,
  queryProviderUsage,
  UsageCache,
  type ResolvedUsageAuth,
  type UsageReport,
} from "@onurpi/pi-usage";

import { CODEX_PROVIDER_ID, toBuiltInCodexModel } from "./codex-family.ts";
import type { CodexProfile } from "./config.ts";

type CodexModel = Model<"openai-codex-responses">;

function headerValue(headers: AuthResult["auth"]["headers"], name: string): string | undefined {
  const match = Object.entries(headers ?? {}).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return typeof match?.[1] === "string" ? match[1] : undefined;
}

function officialBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return true;
  try {
    const url = new URL(baseUrl);
    return url.origin === "https://chatgpt.com";
  } catch {
    return false;
  }
}

function resolvedUsageAuth(
  auth: AuthResult["auth"],
  model: CodexModel,
  salt: Uint8Array,
): ResolvedUsageAuth | undefined {
  if (!officialBaseUrl(auth.baseUrl)) {
    throw new Error(
      "Codex usage cannot send a custom endpoint credential to the official usage endpoint.",
    );
  }
  const authorization =
    headerValue(auth.headers, "Authorization") ??
    (auth.apiKey ? `Bearer ${auth.apiKey}` : undefined);
  if (!authorization) return undefined;
  const headers = { Authorization: authorization };
  return {
    apiKey: auth.apiKey,
    headers,
    fingerprint: fingerprintResolvedAuth({ headers }, salt),
    secrets: [auth.apiKey, authorization].filter((value): value is string => Boolean(value)),
    model: toBuiltInCodexModel(model),
  };
}

export type CodexUsageClient = {
  query(
    profile: CodexProfile,
    auth: AuthResult["auth"],
    model: CodexModel,
    signal: AbortSignal,
  ): Promise<UsageReport | undefined>;
  clear(profile: CodexProfile): void;
};

function exhaustedWindowReset(report: UsageReport, now: number): boolean {
  return report.buckets.some(
    (bucket) =>
      bucket.remaining !== undefined &&
      bucket.remaining <= 0 &&
      bucket.resetsAt !== undefined &&
      bucket.resetsAt * 1_000 <= now,
  );
}

export function createCodexUsageClient(
  refreshMs: number,
  timeoutMs: number,
  salt: Uint8Array = randomBytes(32),
): CodexUsageClient {
  const adapter = adapterForProvider(CODEX_PROVIDER_ID);
  if (!adapter) throw new Error("OpenAI Codex usage support is unavailable.");
  const cache = new UsageCache(refreshMs, 16);
  return {
    query: async (profile, auth, model, signal) => {
      const resolved = resolvedUsageAuth(auth, model, salt);
      if (!resolved) return undefined;
      const cached = cache.get(profile.providerId, resolved.fingerprint);
      if (cached && !exhaustedWindowReset(cached, Date.now())) return cached;
      if (cached) cache.clearProvider(profile.providerId);
      const report = await queryProviderUsage(adapter, resolved, signal, timeoutMs);
      cache.set(profile.providerId, resolved.fingerprint, report);
      return report;
    },
    clear: (profile) => {
      cache.clearProvider(profile.providerId);
    },
  };
}
