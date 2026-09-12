import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CONFIG_FILE_NAME, configPath, parseConfig, readConfig } from "./config.ts";
import { DEFAULT_CONFIG } from "./image-budget.ts";

const temporaryDirs: string[] = [];

function temporaryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "image-budget-"));
  temporaryDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

describe("configPath", () => {
  it("places the config beside other Pi user state", () => {
    expect(configPath("/home/user/.pi/agent")).toBe(`/home/user/.pi/agent/${CONFIG_FILE_NAME}`);
  });
});

describe("parseConfig", () => {
  it("accepts an empty object as defaults", () => {
    const { config, errors } = parseConfig({});
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(errors).toEqual([]);
  });

  it("reads valid overrides", () => {
    const { config, errors } = parseConfig({
      enabled: false,
      maxImageBytes: 1024,
      maxImageWidth: 800,
      maxImageHeight: 600,
      maxImagesPerResult: 1,
      imageBudgetBytes: 4096,
      redactToBytes: 2048,
      notify: false,
      status: false,
    });
    expect(errors).toEqual([]);
    expect(config).toEqual({
      enabled: false,
      maxImageBytes: 1024,
      maxImageWidth: 800,
      maxImageHeight: 600,
      maxImagesPerResult: 1,
      imageBudgetBytes: 4096,
      redactToBytes: 2048,
      notify: false,
      status: false,
    });
  });

  it("falls back per key and reports bad values", () => {
    const { config, errors } = parseConfig({ maxImageBytes: "big", notify: 1 });
    expect(config.maxImageBytes).toBe(DEFAULT_CONFIG.maxImageBytes);
    expect(config.notify).toBe(DEFAULT_CONFIG.notify);
    expect(errors).toEqual([
      "maxImageBytes must be a positive whole number",
      "notify must be true or false",
    ]);
  });

  it("rejects zero, negative, and fractional numbers", () => {
    expect(parseConfig({ maxImageBytes: 0 }).errors).toEqual([
      "maxImageBytes must be a positive whole number",
    ]);
    expect(parseConfig({ maxImageBytes: -5 }).config.maxImageBytes).toBe(
      DEFAULT_CONFIG.maxImageBytes,
    );
    expect(parseConfig({ maxImageBytes: 1.5 }).errors).toHaveLength(1);
  });

  it("reports unknown keys", () => {
    const { errors } = parseConfig({ maxImageBytess: 10 });
    expect(errors).toEqual(["unknown key: maxImageBytess"]);
  });

  it("clamps a low-water target above the budget", () => {
    const { config, errors } = parseConfig({ imageBudgetBytes: 1000, redactToBytes: 2000 });
    expect(config.redactToBytes).toBe(1000);
    expect(errors).toEqual(["redactToBytes must not exceed imageBudgetBytes"]);
  });

  it("rejects a non-object root", () => {
    const { config, errors } = parseConfig([1, 2]);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(errors).toEqual(["expected a JSON object"]);
  });
});

describe("readConfig", () => {
  it("returns defaults when the file does not exist", () => {
    const path = join(temporaryDir(), CONFIG_FILE_NAME);
    expect(readConfig(path)).toEqual({ path, config: DEFAULT_CONFIG, errors: [] });
  });

  it("reads a valid file", () => {
    const path = join(temporaryDir(), CONFIG_FILE_NAME);
    writeFileSync(path, JSON.stringify({ maxImagesPerResult: 2 }));
    const load = readConfig(path);
    expect(load.config.maxImagesPerResult).toBe(2);
    expect(load.errors).toEqual([]);
  });

  it("reports invalid JSON and keeps defaults", () => {
    const path = join(temporaryDir(), CONFIG_FILE_NAME);
    writeFileSync(path, "{not json");
    expect(readConfig(path).errors).toEqual([`${path} is not valid JSON`]);
  });

  it("reports a directory path as unreadable", () => {
    const path = temporaryDir();
    expect(readConfig(path).errors).toEqual([`${path} could not be read`]);
  });
});
