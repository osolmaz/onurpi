import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  codexSwitcherConfigPath,
  loadCodexSwitcherConfig,
  parseCodexSwitcherConfig,
  writeCodexSwitcherConfig,
} from "./config.ts";

const directories: string[] = [];

function validConfig(): unknown {
  return {
    accounts: [
      { id: "primary", billing: "subscription-only" },
      { id: "backup", billing: "allow-credits" },
    ],
    usage: { refreshMinutes: 3, timeoutSeconds: 7 },
  };
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "codex-switcher-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe("parseCodexSwitcherConfig", () => {
  it("uses array order as preference and fallback order", () => {
    expect(parseCodexSwitcherConfig(validConfig())).toEqual({
      accounts: [
        { id: "primary", billing: "subscription-only" },
        { id: "backup", billing: "allow-credits" },
      ],
      refreshMs: 180_000,
      timeoutMs: 7_000,
    });
  });

  it("applies bounded timing defaults and permits an empty account list", () => {
    expect(parseCodexSwitcherConfig({ accounts: [] })).toEqual({
      accounts: [],
      refreshMs: 300_000,
      timeoutMs: 10_000,
    });
  });

  it.each([
    ["missing accounts", {}],
    ["unsafe ID", { accounts: [{ id: "Primary Account", billing: "subscription-only" }] }],
    ["unknown billing", { accounts: [{ id: "primary", billing: "automatic" }] }],
    [
      "duplicate account",
      {
        accounts: [
          { id: "primary", billing: "subscription-only" },
          { id: "primary", billing: "allow-credits" },
        ],
      },
    ],
    ["old profile schema", { profiles: {}, fallbackChain: [] }],
    ["unknown field", { ...(validConfig() as object), secret: "value" }],
  ])("rejects %s", (_name, raw) => {
    expect(() => parseCodexSwitcherConfig(raw)).toThrow();
  });

  it("rejects timing outside the documented bounds", () => {
    const raw = validConfig() as { usage: { refreshMinutes: number } };
    raw.usage.refreshMinutes = 61;
    expect(() => parseCodexSwitcherConfig(raw)).toThrow("at most 60");
  });
});

describe("configuration files", () => {
  it("reports missing files without throwing", () => {
    expect(loadCodexSwitcherConfig("/path/that/does/not/exist")).toEqual({ status: "missing" });
  });

  it("writes and loads a private bounded file", () => {
    const path = join(temporaryDirectory(), "config.json");
    const config = parseCodexSwitcherConfig(validConfig());
    writeCodexSwitcherConfig(path, config);
    expect(loadCodexSwitcherConfig(path)).toEqual({ status: "ready", config });
  });

  it("rejects malformed, oversized, permissive, and symbolic-link files", () => {
    const directory = temporaryDirectory();
    const malformed = join(directory, "malformed.json");
    writeFileSync(malformed, "{secret-token", { mode: 0o600 });
    expect(loadCodexSwitcherConfig(malformed)).toEqual({
      status: "invalid",
      message: "Configuration contains invalid JSON.",
    });

    const oversized = join(directory, "oversized.json");
    writeFileSync(oversized, "x".repeat(64 * 1024 + 1), { mode: 0o600 });
    expect(loadCodexSwitcherConfig(oversized)).toMatchObject({ status: "invalid" });

    const permissive = join(directory, "permissive.json");
    writeFileSync(permissive, JSON.stringify(validConfig()), { mode: 0o600 });
    chmodSync(permissive, 0o644);
    expect(loadCodexSwitcherConfig(permissive)).toMatchObject({ status: "invalid" });

    const link = join(directory, "link.json");
    symlinkSync(malformed, link);
    expect(loadCodexSwitcherConfig(link)).toMatchObject({ status: "invalid" });
  });
});

it("builds the canonical configuration path", () => {
  expect(codexSwitcherConfigPath("/agent")).toBe(join("/agent", "codex-switcher.json"));
});
