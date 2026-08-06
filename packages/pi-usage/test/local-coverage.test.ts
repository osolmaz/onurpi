import assert from "node:assert/strict";
import { test } from "vitest";
import {
  formatProviderStates,
  formatUsageReport,
  formatUsageStatusline,
  normalizeCodexBackendPayload,
  type ProviderUsageState,
  type UsageBucket,
  type UsageReport,
} from "../src/index.js";

function baseReport(overrides: Partial<UsageReport> = {}): UsageReport {
  return {
    providerId: "example",
    providerName: "Example",
    capturedAt: 1_000,
    source: "test",
    semantics: { kind: "project", label: "Example semantics" },
    buckets: [],
    metrics: [],
    ...overrides,
  };
}

test("generic reports render buckets, metrics, account label, and notes", () => {
  const text = formatUsageReport(
    baseReport({
      accountLabel: "acct",
      buckets: [{ id: "b", label: "Build minutes", remaining: 12, unit: "count" }],
      metrics: [{ id: "m", label: "Spend", value: 3.5, unit: "usd" }],
      notes: ["note one"],
    }),
    "configured",
  );
  assert.match(text, /Example Usage · Configured/);
  assert.match(text, /Account: acct/);
  assert.match(text, /Build minutes:\s+12/);
  assert.match(text, /Spend:\s+\$3\.50/);
  assert.match(text, /note one/);
});

test("provider state formatting labels unsupported, auth, and failure states", () => {
  const states: ProviderUsageState[] = [
    {
      providerId: "x",
      providerName: "X",
      displayState: "current",
      status: "unsupported",
      message: "no source",
    },
    {
      providerId: "y",
      providerName: "Y",
      displayState: "configured",
      status: "auth-unavailable",
      message: "no auth",
    },
    {
      providerId: "z",
      providerName: "Z",
      displayState: "configured",
      status: "query-failed",
      message: "boom",
    },
  ];
  const text = formatProviderStates(states);
  assert.match(text, /X · Current\nUnsupported: no source/);
  assert.match(text, /Y · Configured\nAuthentication unavailable: no auth/);
  assert.match(text, /Z · Configured\nQuery failed: boom/);
});

test("codex statusline falls back to credit states when no bucket group applies", () => {
  const creditsReport = (value: number | string) =>
    baseReport({
      providerId: "openai-codex",
      metrics: [{ id: "credits", label: "Credits", value, unit: "count" }],
    });
  assert.equal(formatUsageStatusline(creditsReport("none")), "codex no credits");
  assert.equal(formatUsageStatusline(creditsReport("available")), "codex credits available");
  assert.equal(formatUsageStatusline(creditsReport("unlimited")), "codex credits unlimited");
  assert.equal(formatUsageStatusline(creditsReport(7)), "codex 7 credits");
  assert.equal(
    formatUsageStatusline(baseReport({ providerId: "openai-codex" })),
    "codex usage unavailable",
  );
});

test("codex statusline renders grouped windows with compact labels", () => {
  const bucket = (id: string, windowMinutes?: number): UsageBucket => ({
    id,
    label: id,
    groupId: "codex",
    groupLabel: "Codex",
    remaining: 61,
    unit: "percent",
    ...(windowMinutes === undefined ? {} : { windowMinutes }),
  });
  assert.equal(
    formatUsageStatusline(
      baseReport({
        providerId: "openai-codex",
        buckets: [bucket("codex:primary", 300), bucket("codex:secondary", 10_080)],
      }),
    ),
    "codex 61% 5h 61% wk",
  );
  assert.equal(
    formatUsageStatusline(
      baseReport({ providerId: "openai-codex", buckets: [bucket("codex:primary", 20_160)] }),
    ),
    "codex 61% 2w",
  );
  assert.equal(
    formatUsageStatusline(
      baseReport({ providerId: "openai-codex", buckets: [bucket("codex:primary", 2_880)] }),
    ),
    "codex 61% 2d",
  );
  assert.equal(
    formatUsageStatusline(
      baseReport({ providerId: "openai-codex", buckets: [bucket("codex:primary", 45)] }),
    ),
    "codex 61% 45m",
  );
  assert.equal(
    formatUsageStatusline(
      baseReport({ providerId: "openai-codex", buckets: [bucket("codex:secondary")] }),
    ),
    "codex 61% wk",
  );
});

test("codex statusline selects a model-specific bucket group", () => {
  const report = baseReport({
    providerId: "openai-codex",
    buckets: [
      {
        id: "codex:primary",
        label: "Primary limit",
        groupId: "codex",
        groupLabel: "Codex",
        remaining: 50,
        unit: "percent",
        windowMinutes: 300,
      },
      {
        id: "spark:primary",
        label: "Primary limit",
        groupId: "spark",
        groupLabel: "Codex Spark",
        modelKeys: ["spark"],
        remaining: 100,
        unit: "percent",
        windowMinutes: 300,
      },
    ],
  });
  assert.equal(
    formatUsageStatusline(report, {
      id: "gpt-5.3-codex-spark",
      name: "Spark",
      provider: "openai-codex",
    }),
    "codex spark 100% 5h",
  );
  assert.equal(
    formatUsageStatusline(report, { id: "gpt-5.3-codex", name: "Codex", provider: "openai-codex" }),
    "codex 50% 5h",
  );
  assert.equal(
    formatUsageStatusline(report, { id: "x", name: "x", provider: "openrouter" }),
    "codex 50% 5h",
  );
});

test("copilot reports and statuslines cover unlimited, reset, and overage shapes", () => {
  const quota = (overrides: Partial<UsageBucket>): UsageBucket => ({
    id: "premium-requests",
    label: "Premium requests",
    unit: "count",
    ...overrides,
  });
  assert.match(
    formatUsageReport(baseReport({ providerId: "github-copilot" }), "current"),
    /Copilot quota:\s+unlimited/,
  );
  const limited = baseReport({
    providerId: "github-copilot",
    buckets: [
      quota({ limit: 300, remaining: 246, resetsAt: Math.floor(Date.now() / 1000) + 86_400 }),
    ],
    metrics: [{ id: "overage-used", label: "Additional usage", value: 3, unit: "count" }],
  });
  assert.match(formatUsageReport(limited, "current"), /246 of 300 left · 82% \(resets /);
  assert.match(formatUsageReport(limited, "current"), /Additional usage:\s+3 Premium requests/);
  assert.equal(formatUsageStatusline(limited), "copilot 246/300 82% +3 over");
  const chat = baseReport({
    providerId: "github-copilot",
    buckets: [quota({ id: "chat-requests", label: "Chat messages", limit: 50, remaining: 40 })],
  });
  assert.equal(formatUsageStatusline(chat), "copilot chat 40/50 80%");
  const credits = baseReport({
    providerId: "github-copilot",
    buckets: [quota({ id: "ai-credits", label: "AI credits", limit: 1_500, remaining: 1_200 })],
  });
  assert.equal(formatUsageStatusline(credits), "copilot credits 1200/1500 80%");
  assert.equal(
    formatUsageStatusline(baseReport({ providerId: "github-copilot" })),
    "copilot premium unlimited",
  );
});

test("openrouter reports and statuslines cover cap and spend shapes", () => {
  const noLimit = baseReport({
    providerId: "openrouter",
    metrics: [{ id: "usage-total", label: "Total spend", value: 25.5, unit: "usd" }],
  });
  assert.match(formatUsageReport(noLimit, "current"), /Total spend:\s+\$25\.50/);
  assert.equal(formatUsageStatusline(noLimit), "openrouter $25.50 used");
  const cap = baseReport({
    providerId: "openrouter",
    buckets: [
      {
        id: "key-limit",
        label: "Key limit",
        limit: 100,
        remaining: 74.5,
        unit: "usd",
        period: "monthly",
      },
    ],
  });
  assert.match(
    formatUsageReport(cap, "current"),
    /Key limit \(monthly\):\s+\$74\.50 of \$100\.00 left/,
  );
  assert.equal(formatUsageStatusline(cap), "openrouter $74.50 left");
  const capUnknown = baseReport({
    providerId: "openrouter",
    buckets: [{ id: "key-limit", label: "Key limit", limit: 100, unit: "usd" }],
  });
  assert.match(formatUsageReport(capUnknown, "current"), /\$100\.00 cap; remaining unavailable/);
  assert.equal(formatUsageStatusline(baseReport({ providerId: "openrouter" })), undefined);
});

test("codex normalization handles optional groups, string numbers, and invalid payloads", () => {
  const report = normalizeCodexBackendPayload(
    {
      plan_type: "pro",
      rate_limit: {
        primary_window: {
          used_percent: "20",
          limit_window_seconds: 18_000,
          reset_at: 1_900_000_000,
        },
      },
      additional_rate_limits: [
        null,
        { rate_limit: { primary_window: { used_percent: 1 } } },
        {
          metered_feature: "codex_spark",
          limit_name: "Codex Spark",
          rate_limit: { primary_window: { used_percent: 100, limit_window_seconds: 300 } },
        },
        { metered_feature: "broken", rate_limit: 5 },
      ],
      credits: { has_credits: true, balance: 12.5 },
      rate_limit_reset_credits: { available_count: 2 },
    },
    1_000,
  );
  const primary = report.buckets.find((bucket) => bucket.id === "codex:primary");
  assert.equal(primary?.used, 20);
  assert.equal(primary?.windowMinutes, 300);
  assert.equal(primary?.resetsAt, 1_900_000_000);
  const spark = report.buckets.find((bucket) => bucket.id === "codex_spark:primary");
  assert.equal(spark?.groupLabel, "Codex Spark");
  assert.equal(spark?.remaining, 0);
  assert.equal(
    report.buckets.some((bucket) => bucket.id.startsWith("broken")),
    false,
  );
  assert.deepEqual(
    report.metrics.map((metric) => [metric.id, metric.value]),
    [
      ["credits", 12.5],
      ["reset-credits", 2],
    ],
  );
  assert.deepEqual(report.notes, ["Plan: pro"]);
});

test("codex normalization rejects malformed primary data and empty payloads", () => {
  assert.throws(() => normalizeCodexBackendPayload({ rate_limit: 5 }, 1_000), /not an object/);
  assert.throws(
    () => normalizeCodexBackendPayload({ rate_limit: { primary_window: 5 } }, 1_000),
    /not an object/,
  );
  assert.throws(() => normalizeCodexBackendPayload({}, 1_000), /no displayable usage data/);
  const unlimited = normalizeCodexBackendPayload(
    { credits: { has_credits: true, unlimited: true } },
    1_000,
  );
  assert.deepEqual(unlimited.metrics[0]?.value, "unlimited");
  const none = normalizeCodexBackendPayload({ credits: { has_credits: false } }, 1_000);
  assert.deepEqual(none.metrics[0]?.value, "none");
});
