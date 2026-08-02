import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";

import {
  defaultConfigPath,
  loadConfig,
  resetConfig,
  setConfigModel,
  setConfigThinking,
  validateConfig,
  writeConfig,
} from "../src/config.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

async function configFile(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-reviewer-config-"));
  cleanup.push(root);
  return path.join(root, "nested", "config.json");
}

describe("user config", () => {
  it("uses XDG_CONFIG_HOME and defaults to regular Pi authentication", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-reviewer-xdg-"));
    cleanup.push(root);
    const file = defaultConfigPath({ XDG_CONFIG_HOME: root });
    expect(file).toBe(path.join(root, "pi-reviewer", "config.json"));
    await expect(loadConfig(file)).resolves.toEqual({ version: 1, auth: "pi" });
  });

  it("writes and merges external model defaults atomically", async () => {
    const file = await configFile();
    await expect(setConfigModel("openai-codex/gpt-review", file)).resolves.toEqual({
      version: 1,
      auth: "pi",
      model: "openai-codex/gpt-review",
    });
    await expect(setConfigThinking("high", file)).resolves.toEqual({
      version: 1,
      auth: "pi",
      model: "openai-codex/gpt-review",
      thinking: "high",
    });
    await expect(loadConfig(file)).resolves.toEqual({
      version: 1,
      auth: "pi",
      model: "openai-codex/gpt-review",
      thinking: "high",
    });
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, "utf8")).toContain('"model": "openai-codex/gpt-review"');
    await resetConfig(file);
    await expect(loadConfig(file)).resolves.toEqual({ version: 1, auth: "pi" });
  });

  it("rejects malformed, isolated, and unknown config fields", async () => {
    expect(() => validateConfig([])).toThrow("JSON object");
    expect(() => validateConfig({ version: 2 })).toThrow("version must be 1");
    expect(() => validateConfig({ version: 1, auth: "pi", extra: true })).toThrow("unknown field");
    expect(validateConfig({ version: 1 })).toEqual({ version: 1, auth: "pi" });
    expect(() => validateConfig({ version: 1, auth: "isolated" })).toThrow("auth must be pi");
    expect(() => validateConfig({ version: 1, auth: "pi", model: 1 })).toThrow(
      "model must be a string",
    );
    expect(() => validateConfig({ version: 1, auth: "pi", thinking: "extreme" })).toThrow(
      "thinking must",
    );
    const file = await configFile();
    await writeConfig({ version: 1, auth: "pi" }, file);
    await import("node:fs/promises").then(({ writeFile }) => writeFile(file, "{bad json"));
    await expect(loadConfig(file)).rejects.toThrow("failed to parse");
  });
});
