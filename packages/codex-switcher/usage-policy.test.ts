import type { UsageReport } from "@onurpi/pi-usage";
import { describe, expect, it } from "vitest";

import { minimumRemaining, usageDecision } from "./usage-policy.ts";

function report(remaining: number, credits: number | string = "none"): UsageReport {
  return {
    providerId: "openai-codex",
    providerName: "OpenAI Codex",
    capturedAt: 1,
    source: "test",
    semantics: { kind: "consumer-subscription", label: "Subscription" },
    buckets: [
      { id: "codex:primary", groupId: "codex", label: "Primary", remaining, unit: "percent" },
      {
        id: "codex:secondary",
        groupId: "codex",
        label: "Secondary",
        remaining: 25,
        unit: "percent",
      },
    ],
    metrics: [{ id: "credits", label: "Credits", value: credits }],
  };
}

describe("usageDecision", () => {
  it("keeps profiles with subscription capacity eligible", () => {
    expect(usageDecision(report(1), "gpt-5.6-sol", "subscription-only")).toBe("eligible");
  });

  it("stops subscription-only profiles at zero", () => {
    expect(usageDecision(report(0, 100), "gpt-5.6-sol", "subscription-only")).toBe("exhausted");
  });

  it.each(["available", "unlimited", 1])(
    "permits allow-credits profiles with %s credits",
    (credits) => {
      expect(usageDecision(report(0, credits), "gpt-5.6-sol", "allow-credits")).toBe("eligible");
    },
  );

  it.each(["none", 0])("stops allow-credits profiles without usable %s credits", (credits) => {
    expect(usageDecision(report(0, credits), "gpt-5.6-sol", "allow-credits")).toBe("exhausted");
  });

  it("uses a matching model-specific group", () => {
    const value = report(80);
    value.buckets.push({
      id: "gpt-5.6-sol:primary",
      groupId: "gpt-5.6-sol",
      groupLabel: "GPT 5.6 Sol",
      label: "Primary",
      modelKeys: ["gpt-5.6-sol"],
      remaining: 0,
      unit: "percent",
    });
    expect(usageDecision(value, "gpt-5.6-sol", "subscription-only")).toBe("exhausted");
  });

  it("treats a report without windows as eligible", () => {
    const value = report(0);
    value.buckets = [];
    expect(usageDecision(value, "gpt-5.6-sol", "subscription-only")).toBe("eligible");
  });
});

it("reports the lowest core remaining percentage", () => {
  expect(minimumRemaining(report(20))).toBe(20);
  expect(minimumRemaining({ ...report(20), buckets: [] })).toBeUndefined();
});
