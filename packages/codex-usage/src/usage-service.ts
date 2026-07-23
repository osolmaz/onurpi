import { queryUsage } from "./query.js";
import type { QueryUsageOptions, QueryUsageResult, UsageQueryContext } from "./types.js";

export const USAGE_CACHE_TTL_MS = 5 * 60 * 1000;

export type UsageServiceDependencies = {
  now: () => number;
  query: (
    ctx: UsageQueryContext,
    options: Pick<QueryUsageOptions, "timeoutMs">,
  ) => Promise<QueryUsageResult>;
};

export type UsageService = {
  read: (ctx: UsageQueryContext, options: QueryUsageOptions) => Promise<QueryUsageResult>;
};

export function createUsageService(
  dependencies: UsageServiceDependencies = { now: Date.now, query: queryUsage },
): UsageService {
  let cache: { createdAt: number; result: QueryUsageResult } | undefined;
  const inFlight = new Map<number, Promise<QueryUsageResult>>();

  return {
    async read(ctx, options) {
      const cached = freshCache(cache, dependencies.now());
      if (cached && !options.refresh) return cached.result;
      const existing = inFlight.get(options.timeoutMs);
      if (existing) return existing;

      const request = dependencies
        .query(ctx, { timeoutMs: options.timeoutMs })
        .then((result) => {
          cache = { createdAt: dependencies.now(), result };
          return result;
        })
        .finally(() => {
          if (inFlight.get(options.timeoutMs) === request) {
            inFlight.delete(options.timeoutMs);
          }
        });
      inFlight.set(options.timeoutMs, request);
      return request;
    },
  };
}

function freshCache<T extends { createdAt: number }>(
  cache: T | undefined,
  now: number,
): T | undefined {
  return cache && now - cache.createdAt < USAGE_CACHE_TTL_MS ? cache : undefined;
}
