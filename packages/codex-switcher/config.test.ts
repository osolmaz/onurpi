import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  codexSwitcherConfigPath,
  loadCodexSwitcherConfig,
  parseCodexSwitcherConfig,
  providerIdForProfile,
} from "./config.ts";

const directories: string[] = [];

function validConfig(): unknown {
  return {
    profiles: {
      primary: { label: "Primary", billing: "subscription-only" },
      backup: { label: "Backup", billing: "allow-credits" },
    },
    fallbackChain: ["primary", "backup"],
    usage: { refreshMinutes: 3, timeoutSeconds: 7 },
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe("parseCodexSwitcherConfig", () => {
  it("parses profiles, provider IDs, chain, and usage timing", () => {
    expect(parseCodexSwitcherConfig(validConfig())).toEqual({
      profiles: [
        {
          id: "primary",
          label: "Primary",
          billing: "subscription-only",
          providerId: "openai-codex-primary",
        },
        {
          id: "backup",
          label: "Backup",
          billing: "allow-credits",
          providerId: "openai-codex-backup",
        },
      ],
      fallbackChain: ["primary", "backup"],
      refreshMs: 180_000,
      timeoutMs: 7_000,
    });
  });

  it("applies bounded timing defaults", () => {
    const raw = validConfig() as { usage?: unknown };
    delete raw.usage;
    const parsed = parseCodexSwitcherConfig(raw);
    expect(parsed.refreshMs).toBe(300_000);
    expect(parsed.timeoutMs).toBe(10_000);
  });

  it.each([
    ["empty profiles", { profiles: {}, fallbackChain: [] }],
    [
      "unsafe ID",
      {
        profiles: { "Primary Account": { label: "P", billing: "subscription-only" } },
        fallbackChain: ["Primary Account"],
      },
    ],
    [
      "unknown billing",
      { profiles: { primary: { label: "P", billing: "automatic" } }, fallbackChain: ["primary"] },
    ],
    [
      "duplicate chain",
      {
        profiles: { primary: { label: "P", billing: "subscription-only" } },
        fallbackChain: ["primary", "primary"],
      },
    ],
    ["incomplete chain", validConfig() as object],
    ["unknown field", { ...(validConfig() as object), secret: "value" }],
  ])("rejects %s", (_name, raw) => {
    if (_name === "incomplete chain")
      (raw as { fallbackChain: string[] }).fallbackChain = ["primary"];
    expect(() => parseCodexSwitcherConfig(raw)).toThrow();
  });

  it("rejects timing outside the documented bounds", () => {
    const raw = validConfig() as { usage: { refreshMinutes: number } };
    raw.usage.refreshMinutes = 61;
    expect(() => parseCodexSwitcherConfig(raw)).toThrow("at most 60");
  });
});

describe("loadCodexSwitcherConfig", () => {
  it("reports missing files without throwing", () => {
    expect(loadCodexSwitcherConfig("/path/that/does/not/exist")).toEqual({ status: "missing" });
  });

  it("loads a bounded JSON file", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-switcher-"));
    directories.push(directory);
    const path = join(directory, "config.json");
    writeFileSync(path, JSON.stringify(validConfig()));
    expect(loadCodexSwitcherConfig(path).status).toBe("ready");
  });

  it("reports malformed and oversized files without their contents", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-switcher-"));
    directories.push(directory);
    const malformed = join(directory, "malformed.json");
    writeFileSync(malformed, "{secret-token");
    expect(loadCodexSwitcherConfig(malformed)).toEqual({
      status: "invalid",
      message: "Configuration contains invalid JSON.",
    });
    const oversized = join(directory, "oversized.json");
    writeFileSync(oversized, "x".repeat(64 * 1024 + 1));
    expect(loadCodexSwitcherConfig(oversized)).toMatchObject({ status: "invalid" });
  });
});

it("builds the canonical path and provider ID", () => {
  expect(codexSwitcherConfigPath("/agent")).toBe(join("/agent", "codex-switcher.json"));
  expect(providerIdForProfile("work-two")).toBe("openai-codex-work-two");
});
