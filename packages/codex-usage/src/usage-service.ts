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
  let inFlight: Promise<QueryUsageResult> | undefined;

  return {
    async read(ctx, options) {
      const cached = freshCache(cache, dependencies.now());
      if (cached && !options.refresh) return cached.result;
      if (inFlight) return inFlight;

      const request = dependencies
        .query(ctx, { timeoutMs: options.timeoutMs })
        .then((result) => {
          cache = { createdAt: dependencies.now(), result };
          return result;
        })
        .finally(() => {
          if (inFlight === request) inFlight = undefined;
        });
      inFlight = request;
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
