import { describe, expect, it, vi } from "vitest";
import {
  completeCodexStatusArguments,
  createCodexStatusHandler,
  formatCodexUsageReport,
  isStaleExtensionContextError,
  normalizeAppServerResponse,
  normalizeBackendPayload,
  parseArgs,
  registerCodexUsage,
  type CodexUsageReport,
} from "./index.js";

function report(usedPercent = 25): CodexUsageReport {
  return {
    source: "pi-auth",
    capturedAt: 1_000,
    snapshots: [
      {
        limitId: "codex",
        primary: { usedPercent, windowMinutes: 300 },
        secondary: { usedPercent: 80, windowMinutes: 10_080 },
      },
    ],
    resetCredits: { availableCount: 2 },
  };
}

function commandContext() {
  const notifications: { message: string; level: string | undefined }[] = [];
  let statusWrites = 0;
  return {
    ctx: {
      hasUI: false,
      model: undefined,
      modelRegistry: {
        getApiKeyAndHeaders: () => Promise.resolve({ ok: false as const, error: "unused" }),
        getAvailable: () => [],
        getAll: () => [],
      },
      ui: {
        notify: (message: string, level?: "info" | "warning" | "error") => {
          notifications.push({ message, level });
        },
        setStatus: () => {
          statusWrites += 1;
        },
      },
    },
    notifications,
    getStatusWrites: () => statusWrites,
  };
}

describe("command-only behavior", () => {
  it("registers only the explicit command surface", () => {
    const names: string[] = [];
    registerCodexUsage({
      registerCommand: (name) => {
        names.push(name);
      },
    });
    expect(names).toEqual(["codex-status"]);
  });

  it("offers only refresh and timeout options", () => {
    expect(completeCodexStatusArguments("")?.map((item) => item.label)).toEqual([
      "--refresh",
      "--timeout",
    ]);
    expect(completeCodexStatusArguments("--r")?.map((item) => item.value)).toEqual(["--refresh"]);
    expect(completeCodexStatusArguments("--timeout ")).toBeNull();
    expect(completeCodexStatusArguments("--timeout 2 --r")?.[0]?.value).toBe(
      "--timeout 2 --refresh",
    );
    expect(completeCodexStatusArguments("wat")).toBeNull();
  });

  it("rejects removed statusline flags", () => {
    expect(parseArgs("--no-statusline")).toEqual({
      ok: false,
      error:
        "Unknown option: --no-statusline. Usage: /codex-status [--refresh] [--timeout seconds]",
    });
    expect(parseArgs("--clear-statusline").ok).toBe(false);
  });

  it("parses refresh and bounded timeouts", () => {
    expect(parseArgs("--refresh --timeout 2")).toEqual({
      ok: true,
      value: { refresh: true, timeoutMs: 2_000 },
    });
    expect(parseArgs("--timeout").ok).toBe(false);
    expect(parseArgs("--timeout 0").ok).toBe(false);
    expect(parseArgs("--timeout 121").ok).toBe(false);
    expect(parseArgs("--timeout nope").ok).toBe(false);
  });

  it("caches reports without publishing status", async () => {
    let now = 10_000;
    const query = vi.fn(() => Promise.resolve({ ok: true as const, report: report() }));
    const handler = createCodexStatusHandler({ now: () => now, query });
    const fixture = commandContext();

    await handler("", fixture.ctx);
    now += 1_000;
    await handler("", fixture.ctx);
    await handler("--refresh", fixture.ctx);

    expect(query).toHaveBeenCalledTimes(2);
    expect(fixture.notifications).toHaveLength(3);
    expect(fixture.notifications[0]?.message).toContain("75% left");
    expect(fixture.getStatusWrites()).toBe(0);
  });

  it("refreshes an expired cache and reports query failures", async () => {
    let now = 10_000;
    let queryCount = 0;
    const query = vi.fn(() => {
      queryCount += 1;
      return Promise.resolve(
        queryCount === 1
          ? { ok: true as const, report: report() }
          : {
              ok: false as const,
              errors: [{ source: "pi-auth" as const, message: "denied" }],
            },
      );
    });
    const handler = createCodexStatusHandler({ now: () => now, query });
    const fixture = commandContext();

    await handler("", fixture.ctx);
    now += 5 * 60 * 1_000;
    await handler("", fixture.ctx);

    expect(query).toHaveBeenCalledTimes(2);
    expect(fixture.notifications.at(-1)?.message).toContain("Pi auth direct: denied");
    expect(fixture.notifications.at(-1)?.level).toBe("error");
  });

  it("warns for invalid arguments without querying", async () => {
    const query = vi.fn(() => Promise.resolve({ ok: true as const, report: report() }));
    const handler = createCodexStatusHandler({ now: Date.now, query });
    const fixture = commandContext();

    await handler("--bad", fixture.ctx);

    expect(query).not.toHaveBeenCalled();
    expect(fixture.notifications[0]?.level).toBe("warning");
  });

  it("ignores stale extension contexts and rethrows other failures", async () => {
    const stale = new Error("This extension ctx is stale after session replacement or reload.");
    const staleHandler = createCodexStatusHandler({
      now: Date.now,
      query: () => Promise.reject(stale),
    });
    const fixture = commandContext();
    await expect(staleHandler("", fixture.ctx)).resolves.toBeUndefined();

    const failure = new Error("network broke");
    const failingHandler = createCodexStatusHandler({
      now: Date.now,
      query: () => Promise.reject(failure),
    });
    await expect(failingHandler("", fixture.ctx)).rejects.toThrow("network broke");
    expect(isStaleExtensionContextError(stale)).toBe(true);
    expect(isStaleExtensionContextError(failure)).toBe(false);
  });
});

describe("normalization", () => {
  it("keeps primary, additional, credits, and reset limits", () => {
    const normalized = normalizeBackendPayload(
      {
        plan_type: "team",
        rate_limit: {
          primary_window: { used_percent: 25, limit_window_seconds: 18_000, reset_at: 1 },
          secondary_window: { used_percent: "50", limit_window_seconds: 604_800 },
        },
        credits: { has_credits: true, unlimited: false, balance: "12" },
        rate_limit_reset_credits: { available_count: 3 },
        additional_rate_limits: [
          null,
          {
            limit_name: "GPT-5.3 Codex Spark",
            metered_feature: "gpt-5.3-codex-spark",
            rate_limit: { primary_window: { used_percent: 10 } },
          },
        ],
      },
      1_000,
      "pi-auth",
    );

    expect(normalized.planType).toBe("team");
    expect(normalized.snapshots).toHaveLength(2);
    expect(normalized.snapshots[0]?.primary).toEqual({
      usedPercent: 25,
      windowMinutes: 300,
      resetsAt: 1,
    });
    expect(normalized.snapshots[0]?.credits?.balance).toBe("12");
    expect(normalized.snapshots[1]?.limitId).toBe("gpt-5.3-codex-spark");
    expect(normalized.resetCredits).toEqual({ availableCount: 3 });
  });

  it("accepts reset-credit-only backend responses", () => {
    const normalized = normalizeBackendPayload(
      { plan_type: "plus", rate_limit_reset_credits: { available_count: "2" } },
      1_500,
      "pi-auth",
    );
    expect(normalized.snapshots).toEqual([]);
    expect(normalized.resetCredits).toEqual({ availableCount: 2 });
  });

  it("skips malformed optional backend buckets", () => {
    const normalized = normalizeBackendPayload(
      {
        rate_limit: { primary_window: { used_percent: 25 } },
        additional_rate_limits: [
          { metered_feature: "broken", rate_limit: "not-an-object" },
          { rate_limit: null },
        ],
      },
      2_000,
      "pi-auth",
    );
    expect(normalized.snapshots).toHaveLength(1);
  });

  it("keeps required backend payloads strict", () => {
    expect(() => normalizeBackendPayload("bad", 0, "pi-auth")).toThrow(
      "Codex usage payload was not an object",
    );
    expect(() => normalizeBackendPayload({ rate_limit: "bad" }, 0, "pi-auth")).toThrow(
      "rate limit was not an object",
    );
    expect(() => normalizeBackendPayload({}, 0, "pi-auth")).toThrow("no displayable usage data");
  });

  it("merges app-server snapshots and normalizes reset-credit details", () => {
    const normalized = normalizeAppServerResponse(
      {
        rateLimits: { limitId: "codex", primary: { usedPercent: 40 }, planType: "team" },
        rateLimitsByLimitId: {
          codex: {
            limitId: "codex",
            secondary: { usedPercent: 20, windowDurationMins: 10_080 },
          },
        },
        rateLimitResetCredits: {
          availableCount: 2,
          credits: [
            {
              id: "reset-1",
              resetType: "codexRateLimits",
              status: "available",
              grantedAt: 1,
              expiresAt: 2,
              title: "Full reset",
              description: "Ready",
            },
          ],
        },
      },
      3_000,
    );

    expect(normalized.planType).toBe("team");
    expect(normalized.snapshots).toHaveLength(1);
    expect(normalized.snapshots[0]?.primary?.usedPercent).toBe(40);
    expect(normalized.snapshots[0]?.secondary?.windowMinutes).toBe(10_080);
    expect(normalized.resetCredits?.credits?.[0]).toEqual({
      id: "reset-1",
      resetType: "codexRateLimits",
      status: "available",
      grantedAt: 1,
      expiresAt: 2,
      title: "Full reset",
      description: "Ready",
    });
  });

  it("skips malformed optional app-server buckets", () => {
    const normalized = normalizeAppServerResponse(
      {
        rateLimits: { primary: { usedPercent: 40 } },
        rateLimitsByLimitId: { broken: "bad" },
      },
      4_000,
    );
    expect(normalized.snapshots).toHaveLength(1);

    const arrayMap = normalizeAppServerResponse(
      { rateLimits: { primary: { usedPercent: 40 } }, rateLimitsByLimitId: [] },
      4_001,
    );
    expect(arrayMap.snapshots).toHaveLength(1);
  });

  it("distinguishes empty, malformed, and capped reset-credit details", () => {
    const empty = normalizeAppServerResponse(
      { rateLimitResetCredits: { availableCount: 0, credits: [] } },
      5_000,
    );
    const malformed = normalizeAppServerResponse(
      { rateLimitResetCredits: { availableCount: 2, credits: [null, { id: "" }] } },
      5_001,
    );
    const capped = normalizeAppServerResponse(
      {
        rateLimitResetCredits: {
          availableCount: 1,
          credits: [{ id: "one" }, { id: "two" }],
        },
      },
      5_002,
    );

    expect(empty.resetCredits).toEqual({ availableCount: 0, credits: [] });
    expect(malformed.resetCredits).toEqual({ availableCount: 2 });
    expect(capped.resetCredits).toEqual({ availableCount: 1, credits: [{ id: "one" }] });
  });

  it("keeps required app-server payloads strict", () => {
    expect(() => normalizeAppServerResponse("bad", 0)).toThrow(
      "codex app-server response was not an object",
    );
    expect(() => normalizeAppServerResponse({ rateLimits: "bad" }, 0)).toThrow(
      "app-server rate-limit snapshot was not an object",
    );
    expect(() => normalizeAppServerResponse({}, 0)).toThrow("no displayable usage data");
  });
});

describe("report formatting", () => {
  it("shows remaining windows and reset credits without compact status text", () => {
    const text = formatCodexUsageReport(report());
    expect(text).toContain("5h limit:");
    expect(text).toContain("75% left");
    expect(text).toContain("Weekly limit:");
    expect(text).toMatch(/Usage limit resets:\s+2 available/);
    expect(text).not.toContain("codex 0% wk");
  });

  it("labels additional and unusual window durations", () => {
    const text = formatCodexUsageReport({
      source: "pi-auth",
      capturedAt: 0,
      snapshots: [
        {
          limitId: "other-limit",
          limitName: "Other",
          primary: { usedPercent: -20, windowMinutes: 1_440 },
          secondary: { usedPercent: 200, windowMinutes: 90 },
        },
      ],
    });
    expect(text).toContain("Other limit:");
    expect(text).toContain("1d limit:");
    expect(text).toContain("90m limit:");
    expect(text).toContain("100% left");
    expect(text).toContain("0% left");
  });

  it("reports unavailable windows", () => {
    const text = formatCodexUsageReport({
      source: "pi-auth",
      capturedAt: 0,
      snapshots: [{ limitId: "codex", credits: { hasCredits: true, unlimited: false } }],
    });
    expect(text).toContain("Limits unavailable for this account");
  });
});
