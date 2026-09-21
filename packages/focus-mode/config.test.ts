import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONFIG_FILE_NAME,
  CONFIG_PATH_ENV,
  configPath,
  DEFAULT_CONFIG,
  loadConfig,
  parseConfig,
  resolveConfigPath,
  writeMaxAgents,
} from "./config.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "focus-mode-config-"));
}

describe("loadConfig", () => {
  it("returns the defaults when the file is missing", () => {
    const path = join(tempDir(), "absent.json");
    const loaded = loadConfig(path);
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.errors).toEqual([]);
    expect(loaded.path).toBe(path);
  });

  it("reports one error and keeps the defaults on malformed JSON", () => {
    const path = join(tempDir(), CONFIG_FILE_NAME);
    writeFileSync(path, "{ not json");
    const loaded = loadConfig(path);
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.errors).toHaveLength(1);
    expect(loaded.errors[0]).toContain("invalid JSON");
  });

  it("keeps the cap default of two", () => {
    expect(DEFAULT_CONFIG.maxAgents).toBe(2);
  });
});

describe("parseConfig", () => {
  it("rejects a value that is not an object", () => {
    const { config, errors } = parseConfig([1, 2, 3]);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(errors).toEqual(["expected a JSON object"]);
  });

  it("reports a non-positive or non-integer cap", () => {
    for (const value of [0, -3, 2.5, "4"]) {
      const { config, errors } = parseConfig({ maxAgents: value });
      expect(config.maxAgents).toBe(DEFAULT_CONFIG.maxAgents);
      expect(errors).toEqual(["maxAgents must be a positive whole number"]);
    }
  });

  it("clamps a cap above the maximum", () => {
    const { config, errors } = parseConfig({ maxAgents: 40 });
    expect(config.maxAgents).toBe(16);
    expect(errors).toEqual(["maxAgents must be between 1 and 16"]);
  });

  it("clamps the heartbeat and the stop poll", () => {
    expect(parseConfig({ heartbeatMs: 100 }).config.heartbeatMs).toBe(1000);
    expect(parseConfig({ heartbeatMs: 90000 }).config.heartbeatMs).toBe(60000);
    expect(parseConfig({ stopPollMs: 5 }).config.stopPollMs).toBe(100);
  });

  it("raises a staleness window that is too short for the heartbeat", () => {
    const { config, errors } = parseConfig({ heartbeatMs: 5000, staleMs: 6000 });
    expect(config.staleMs).toBe(10000);
    expect(errors).toEqual(["staleMs must be at least twice heartbeatMs (10000)"]);
  });

  it("rejects an unknown victim policy and an unknown key", () => {
    const { config, errors } = parseConfig({ victimPolicy: "random", extra: true });
    expect(config.victimPolicy).toBe("newest");
    expect(errors).toEqual(["unknown key: extra", "victimPolicy must be newest or oldest"]);
  });

  it("reports wrong types for the boolean keys", () => {
    const { errors } = parseConfig({ enabled: "yes", notify: 1 });
    expect(errors).toEqual(["enabled must be true or false", "notify must be true or false"]);
  });

  it("accepts the oldest policy", () => {
    expect(parseConfig({ victimPolicy: "oldest" }).config.victimPolicy).toBe("oldest");
  });
});

describe("paths", () => {
  it("builds the user state path", () => {
    expect(configPath("/home/user/.pi/agent")).toBe("/home/user/.pi/agent/focus-mode.json");
  });

  it("honours the environment override", () => {
    const env = { [CONFIG_PATH_ENV]: "/tmp/custom.json" } as NodeJS.ProcessEnv;
    expect(resolveConfigPath("/home/user/.pi/agent", env)).toBe("/tmp/custom.json");
    const empty = { [CONFIG_PATH_ENV]: "" } as NodeJS.ProcessEnv;
    expect(resolveConfigPath("/agent", empty)).toBe("/agent/focus-mode.json");
    expect(resolveConfigPath("/agent", {} as NodeJS.ProcessEnv)).toBe("/agent/focus-mode.json");
  });
});

describe("writeMaxAgents", () => {
  it("round-trips a new cap and keeps unknown keys", () => {
    const dir = tempDir();
    const path = join(dir, CONFIG_FILE_NAME);
    writeFileSync(path, `${JSON.stringify({ enabled: true, future: "keep" })}\n`);
    const loaded = writeMaxAgents(path, 3);
    expect(loaded.config.maxAgents).toBe(3);
    expect(loaded.config.enabled).toBe(true);
    const written: unknown = JSON.parse(readFileSync(path, "utf8"));
    expect(written).toMatchObject({ future: "keep", maxAgents: 3 });
  });

  it("clamps and tolerates a missing file", () => {
    const path = join(tempDir(), CONFIG_FILE_NAME);
    expect(writeMaxAgents(path, 99).config.maxAgents).toBe(16);
    expect(writeMaxAgents(path, 0).config.maxAgents).toBe(1);
  });
});
