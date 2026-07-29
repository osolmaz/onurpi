import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import {
  CODEX_WEEKLY_STATUS_ID,
  createUsageService,
  createWeeklyStatusController,
  formatWeeklyRemaining,
  isCodexModel,
  USAGE_CACHE_TTL_MS,
  type CodexUsageReport,
} from "./index.js";
import type { QueryUsageResult } from "./src/types.js";

function model(provider = "openai-codex"): Model<Api> {
  return {
    id: "gpt-5.4",
    name: "GPT-5.4",
    api: "openai-codex-responses",
    provider,
    baseUrl: "https://example.test",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272_000,
    maxTokens: 16_384,
  };
}

function report(usedPercent = 41, windowMinutes: number | null = 10_080): CodexUsageReport {
  return {
    source: "pi-auth",
    capturedAt: 1_000,
    snapshots: [
      {
        limitId: "codex",
        primary: { usedPercent: 10, windowMinutes: 300 },
        secondary: { usedPercent, ...(windowMinutes === null ? {} : { windowMinutes }) },
      },
    ],
  };
}

function context(selectedModel = model()) {
  const statuses: { id: string; text: string | undefined }[] = [];
  return {
    ctx: {
      model: selectedModel,
      modelRegistry: {
        getApiKeyAndHeaders: () => Promise.resolve({ ok: false as const, error: "unused" }),
        getAvailable: () => [selectedModel],
        getAll: () => [selectedModel],
      },
      ui: {
        setStatus: (id: string, text: string | undefined) => {
          statuses.push({ id, text });
        },
      },
    },
    statuses,
  };
}

describe("weekly status formatting", () => {
  it("formats the primary Codex weekly window as remaining percentage", () => {
    expect(formatWeeklyRemaining(report(41))).toBe("59% wk");
    expect(formatWeeklyRemaining(report(-10))).toBe("100% wk");
    expect(formatWeeklyRemaining(report(150))).toBe("0% wk");
    expect(formatWeeklyRemaining(report(20, null))).toBe("80% wk");
    expect(
      formatWeeklyRemaining({
        source: "pi-auth",
        capturedAt: 0,
        snapshots: [
          {
            limitId: "codex",
            primary: { usedPercent: 44, windowMinutes: 10_080 },
          },
        ],
      }),
    ).toBe("56% wk");
  });

  it("rejects non-weekly and non-primary buckets", () => {
    expect(formatWeeklyRemaining(report(25, 90))).toBeUndefined();
    expect(
      formatWeeklyRemaining({
        source: "pi-auth",
        capturedAt: 0,
        snapshots: [
          {
            limitId: "gpt-5.4-codex-spark",
            secondary: { usedPercent: 25, windowMinutes: 10_080 },
          },
        ],
      }),
    ).toBeUndefined();
  });

  it("recognizes only the Codex subscription provider", () => {
    expect(isCodexModel(model())).toBe(true);
    expect(isCodexModel(model("openai"))).toBe(false);
    expect(isCodexModel(undefined)).toBe(false);
  });
});

describe("usage service", () => {
  it("deduplicates matching timeouts without weakening a shorter command timeout", async () => {
    const query = vi.fn((_ctx, options: { timeoutMs: number }) =>
      Promise.resolve({ ok: true as const, report: report(options.timeoutMs / 1_000) }),
    );
    const service = createUsageService({ now: Date.now, query });
    const fixture = context();

    await Promise.all([
      service.read(fixture.ctx, { refresh: true, timeoutMs: 15_000 }),
      service.read(fixture.ctx, { refresh: true, timeoutMs: 1_000 }),
      service.read(fixture.ctx, { refresh: true, timeoutMs: 1_000 }),
    ]);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.map(([, options]) => options.timeoutMs)).toEqual([15_000, 1_000]);
  });

  it("does not let an older concurrent request replace the latest cache", async () => {
    const resolvers = new Map<number, (result: QueryUsageResult) => void>();
    const query = vi.fn(
      (_ctx, options: { timeoutMs: number }) =>
        new Promise<QueryUsageResult>((resolve) => {
          resolvers.set(options.timeoutMs, resolve);
        }),
    );
    const service = createUsageService({ now: Date.now, query });
    const fixture = context();

    const older = service.read(fixture.ctx, { refresh: true, timeoutMs: 15_000 });
    const latest = service.read(fixture.ctx, { refresh: true, timeoutMs: 1_000 });
    resolvers.get(1_000)?.({ ok: true, report: report(20) });
    await latest;
    resolvers.get(15_000)?.({ ok: true, report: report(90) });
    await older;
    const cached = await service.read(fixture.ctx, { refresh: false, timeoutMs: 15_000 });

    expect(query).toHaveBeenCalledTimes(2);
    expect(cached.ok ? formatWeeklyRemaining(cached.report) : undefined).toBe("80% wk");
  });
});

describe("weekly status lifecycle", () => {
  it("queries only for Codex models and clears on other providers", async () => {
    const query = vi.fn(() => Promise.resolve({ ok: true as const, report: report() }));
    const service = createUsageService({ now: () => 1_000, query });
    const controller = createWeeklyStatusController(service);
    const fixture = context();

    await controller.sync(fixture.ctx);
    await controller.sync(fixture.ctx, model("anthropic"));

    expect(query).toHaveBeenCalledTimes(1);
    expect(fixture.statuses).toEqual([
      { id: CODEX_WEEKLY_STATUS_ID, text: "59% wk" },
      { id: CODEX_WEEKLY_STATUS_ID, text: undefined },
    ]);
  });

  it("reuses cached and in-flight reads, then refreshes after five minutes", async () => {
    let now = 10_000;
    let resolveQuery: ((result: QueryUsageResult) => void) | undefined;
    const query = vi.fn(
      () =>
        new Promise<QueryUsageResult>((resolve) => {
          resolveQuery = resolve;
        }),
    );
    const service = createUsageService({ now: () => now, query });
    const controller = createWeeklyStatusController(service);
    const fixture = context();

    const first = controller.sync(fixture.ctx);
    const second = controller.sync(fixture.ctx);
    resolveQuery?.({ ok: true, report: report() });
    await Promise.all([first, second]);
    await controller.sync(fixture.ctx);
    now += USAGE_CACHE_TTL_MS;
    const refreshed = controller.sync(fixture.ctx);
    resolveQuery?.({ ok: true, report: report(42) });
    await refreshed;

    expect(query).toHaveBeenCalledTimes(2);
    expect(fixture.statuses.at(-1)).toEqual({
      id: CODEX_WEEKLY_STATUS_ID,
      text: "58% wk",
    });
  });

  it("does not republish an in-flight result after switching away", async () => {
    let resolveQuery: ((result: QueryUsageResult) => void) | undefined;
    const service = createUsageService({
      now: Date.now,
      query: () =>
        new Promise<QueryUsageResult>((resolve) => {
          resolveQuery = resolve;
        }),
    });
    const controller = createWeeklyStatusController(service);
    const fixture = context();

    const pending = controller.sync(fixture.ctx);
    await controller.sync(fixture.ctx, model("anthropic"));
    resolveQuery?.({ ok: true, report: report() });
    await pending;

    expect(fixture.statuses).toEqual([{ id: CODEX_WEEKLY_STATUS_ID, text: undefined }]);
  });

  it("silently throttles automatic query failures and publishes explicit reports", async () => {
    const query = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        errors: [{ source: "pi-auth" as const, message: "denied" }],
      }),
    );
    const service = createUsageService({
      now: Date.now,
      query,
    });
    const controller = createWeeklyStatusController(service);
    const fixture = context();

    await expect(controller.sync(fixture.ctx)).resolves.toBeUndefined();
    await expect(controller.sync(fixture.ctx)).resolves.toBeUndefined();
    controller.publish(fixture.ctx, report(25));
    controller.clear(fixture.ctx);

    expect(query).toHaveBeenCalledOnce();
    expect(fixture.statuses).toEqual([
      { id: CODEX_WEEKLY_STATUS_ID, text: undefined },
      { id: CODEX_WEEKLY_STATUS_ID, text: undefined },
      { id: CODEX_WEEKLY_STATUS_ID, text: "75% wk" },
      { id: CODEX_WEEKLY_STATUS_ID, text: undefined },
    ]);
  });
});
