import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CONFIG_FILE_NAME, configPath, parseConfig, readConfig } from "./config.ts";
import { DEFAULT_CONFIG } from "./context-budget.ts";

function temporaryDir(): string {
  return mkdtempSync(join(tmpdir(), "context-budget-test-"));
}

describe("configPath", () => {
  it("joins the agent directory and the file name", () => {
    expect(configPath("/agent")).toBe(join("/agent", CONFIG_FILE_NAME));
  });
});

describe("parseConfig", () => {
  it("accepts every key", () => {
    const { config, errors } = parseConfig({
      enabled: false,
      warnChars: 50_000,
      warnTokens: 0,
      charsPerToken: 3,
      status: false,
      notify: false,
    });
    expect(errors).toEqual([]);
    expect(config).toEqual({
      enabled: false,
      warnChars: 50_000,
      warnTokens: 0,
      charsPerToken: 3,
      status: false,
      notify: false,
    });
  });

  it("falls back to defaults for a non-object", () => {
    const { config, errors } = parseConfig([]);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(errors).toEqual(["expected a JSON object"]);
  });

  it("reports unknown keys as typos", () => {
    const { errors } = parseConfig({ warnChars: 1000, warnChar: 2000 });
    expect(errors).toContain("unknown key: warnChar");
  });

  it("rejects wrong types and non-positive numbers", () => {
    const { errors, config } = parseConfig({
      enabled: "yes",
      warnChars: 1.5,
      warnTokens: -1,
      charsPerToken: 0,
      status: "no",
      notify: 1,
    });
    expect(errors).toHaveLength(6);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("allows a zero token threshold so that only characters are checked", () => {
    const { config, errors } = parseConfig({ warnTokens: 0 });
    expect(errors).toEqual([]);
    expect(config.warnTokens).toBe(0);
  });
});

describe("readConfig", () => {
  it("uses defaults when the file is missing", () => {
    const path = join(temporaryDir(), CONFIG_FILE_NAME);
    const load = readConfig(path);
    expect(load.config).toEqual(DEFAULT_CONFIG);
    expect(load.errors).toEqual([]);
    expect(load.path).toBe(path);
  });

  it("reads a valid file", () => {
    const path = join(temporaryDir(), CONFIG_FILE_NAME);
    writeFileSync(path, JSON.stringify({ warnChars: 30_000 }), "utf8");
    expect(readConfig(path).config.warnChars).toBe(30_000);
  });

  it("falls back with a message for broken JSON", () => {
    const path = join(temporaryDir(), CONFIG_FILE_NAME);
    writeFileSync(path, "{not json", "utf8");
    const load = readConfig(path);
    expect(load.config).toEqual(DEFAULT_CONFIG);
    expect(load.errors[0]).toContain("is not valid JSON");
  });

  it("falls back with a message when the path cannot be read", () => {
    const path = temporaryDir();
    mkdirSync(join(path, "sub"));
    const load = readConfig(path);
    expect(load.config).toEqual(DEFAULT_CONFIG);
    expect(load.errors[0]).toContain("could not be read");
  });
});
