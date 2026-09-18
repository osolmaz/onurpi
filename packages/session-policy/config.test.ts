import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CONFIG_FILE_NAME, configPath, DEFAULT_CONFIG, parseConfig, readConfig } from "./config.ts";

const temporaryDirs: string[] = [];

function temporaryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "session-policy-config-"));
  temporaryDirs.push(dir);
  return dir;
}

function configFile(text: string): string {
  const path = join(temporaryDir(), CONFIG_FILE_NAME);
  writeFileSync(path, text);
  return path;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

describe("configPath", () => {
  it("puts the config file beside Pi's other user state", () => {
    expect(configPath("/home/onur/.pi/agent")).toBe("/home/onur/.pi/agent/session-policy.json");
  });
});

describe("readConfig", () => {
  it("uses defaults when the file is missing", () => {
    const load = readConfig(join(temporaryDir(), CONFIG_FILE_NAME));
    expect(load.config).toEqual(DEFAULT_CONFIG);
    expect(load.errors).toEqual([]);
  });

  it("uses defaults when the file is not valid JSON", () => {
    const load = readConfig(configFile("{ nope"));
    expect(load.config).toEqual(DEFAULT_CONFIG);
    expect(load.errors[0]).toContain("is not valid JSON");
  });

  it("uses defaults when the file cannot be read", () => {
    const dir = temporaryDir();
    mkdirSync(join(dir, "session-policy.json"));
    const load = readConfig(join(dir, "session-policy.json"));
    expect(load.config).toEqual(DEFAULT_CONFIG);
    expect(load.errors[0]).toContain("could not be read");
  });

  it("reads a valid file", () => {
    const load = readConfig(configFile(JSON.stringify({ maxImageBytes: 1024, notify: false })));
    expect(load.errors).toEqual([]);
    expect(load.config.maxImageBytes).toBe(1024);
    expect(load.config.notify).toBe(false);
    expect(load.config.cacheMaxBytes).toBe(DEFAULT_CONFIG.cacheMaxBytes);
  });
});

describe("parseConfig", () => {
  it("rejects a value that is not an object", () => {
    const { config, errors } = parseConfig([1, 2]);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(errors).toEqual(["expected a JSON object"]);
  });

  it("reports an unknown key as a typo", () => {
    const { config, errors } = parseConfig({ maxImageWidths: 800 });
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(errors).toEqual(["unknown key: maxImageWidths"]);
  });

  it("falls back to the default for each invalid value", () => {
    const { config, errors } = parseConfig({
      enabled: "yes",
      maxImageBytes: -1,
      maxImageWidth: 1.5,
      maxImageHeight: 0,
      cacheMaxBytes: "big",
      notify: 1,
    });
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(errors).toEqual([
      "enabled must be true or false",
      "maxImageBytes must be a positive whole number",
      "maxImageWidth must be a positive whole number",
      "maxImageHeight must be a positive whole number",
      "cacheMaxBytes must be a positive whole number",
      "notify must be true or false",
    ]);
  });

  it("accepts a full valid file", () => {
    const { config, errors } = parseConfig({
      enabled: false,
      maxImageBytes: 1,
      maxImageWidth: 2,
      maxImageHeight: 3,
      cacheMaxBytes: 4,
      notify: false,
    });
    expect(errors).toEqual([]);
    expect(config).toEqual({
      enabled: false,
      maxImageBytes: 1,
      maxImageWidth: 2,
      maxImageHeight: 3,
      cacheMaxBytes: 4,
      notify: false,
    });
  });
});
