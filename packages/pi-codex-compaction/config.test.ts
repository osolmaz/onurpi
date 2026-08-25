import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { globalConfigPath, loadConfig, parseConfig, projectConfigPath } from "./config.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-codex-compaction-config-"));
}

describe("parseConfig", () => {
  it("accepts only valid fields", () => {
    expect(parseConfig({ autoCompact: false, thresholdRatio: 0.5 })).toEqual({
      autoCompact: false,
      thresholdRatio: 0.5,
    });
    expect(parseConfig({ autoCompact: "yes", thresholdRatio: 1.5 })).toEqual({});
    expect(parseConfig({ thresholdRatio: 0 })).toEqual({});
    expect(parseConfig({ thresholdRatio: 1 })).toEqual({});
    expect(parseConfig(null)).toEqual({});
    expect(parseConfig("autoCompact")).toEqual({});
  });
});

describe("loadConfig", () => {
  it("uses defaults when no config files exist", () => {
    const home = tempDir();
    vi.stubEnv("HOME", home);
    try {
      expect(loadConfig(tempDir(), true)).toEqual({ autoCompact: true, thresholdRatio: 0.9 });
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("lets trusted project config override the global config", () => {
    const home = tempDir();
    const project = tempDir();
    vi.stubEnv("HOME", home);
    try {
      mkdirSync(join(home, ".pi", "agent"), { recursive: true });
      writeFileSync(globalConfigPath(home), JSON.stringify({ thresholdRatio: 0.8 }));
      mkdirSync(join(project, ".pi"), { recursive: true });
      writeFileSync(projectConfigPath(project), JSON.stringify({ autoCompact: false }));

      expect(loadConfig(project, true)).toEqual({ autoCompact: false, thresholdRatio: 0.8 });
      // Untrusted projects cannot change behavior.
      expect(loadConfig(project, false)).toEqual({ autoCompact: true, thresholdRatio: 0.8 });
    } finally {
      rmSync(home, { force: true, recursive: true });
      rmSync(project, { force: true, recursive: true });
    }
  });

  it("falls back to defaults for malformed config files", () => {
    const home = tempDir();
    vi.stubEnv("HOME", home);
    try {
      mkdirSync(join(home, ".pi", "agent"), { recursive: true });
      writeFileSync(globalConfigPath(home), "{ not json");
      expect(loadConfig(tempDir(), false)).toEqual({ autoCompact: true, thresholdRatio: 0.9 });
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});
