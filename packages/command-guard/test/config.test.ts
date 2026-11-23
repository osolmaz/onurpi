import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { registerCommandGuard } from "../index.ts";
import {
  CONFIG_FILE_NAME,
  guardConfigStatus,
  parseGuardConfig,
  readGuardConfig,
} from "../src/config.ts";

function agentDirWith(content: string | undefined): string {
  const directory = mkdtempSync(join(tmpdir(), "command-guard-config-"));
  if (content !== undefined) writeFileSync(join(directory, CONFIG_FILE_NAME), content);
  return directory;
}

type CommandDefinition = {
  handler: (
    args: string,
    ctx: { ui: { notify: (text: string, level: string) => void } },
  ) => Promise<void> | void;
};

function fakePi() {
  const on = vi.fn();
  const commands = new Map<string, CommandDefinition>();
  const pi = {
    getActiveTools: () => ["bash"],
    getAllTools: () => [],
    on,
    registerCommand: (name: string, definition: unknown) => {
      commands.set(name, definition as CommandDefinition);
    },
    registerTool: vi.fn(),
    setActiveTools: vi.fn(),
  };
  return { commands, on, pi: pi as unknown as ExtensionAPI };
}

describe("Command Guard config file", () => {
  it("is on without a file", () => {
    expect(readGuardConfig(agentDirWith(undefined))).toEqual({ mode: "on" });
  });

  it("turns off with enabled false and stays on with enabled true", () => {
    const off = agentDirWith('{ "enabled": false }');
    expect(readGuardConfig(off)).toEqual({ mode: "off", path: join(off, CONFIG_FILE_NAME) });
    expect(readGuardConfig(agentDirWith('{ "enabled": true }'))).toEqual({ mode: "on" });
  });

  it("keeps the guard on for a broken file and says why", () => {
    expect(readGuardConfig(agentDirWith("{ not json")).mode).toBe("on-after-error");
    expect(parseGuardConfig([], "f").mode).toBe("on-after-error");
    expect(parseGuardConfig({ enabled: "false" }, "f")).toEqual({
      mode: "on-after-error",
      path: "f",
      error: '"enabled" must be true or false',
    });
    expect(parseGuardConfig({ enabled: false, extra: 1 }, "f")).toEqual({
      mode: "on-after-error",
      path: "f",
      error: 'unknown key "extra"; the only key is "enabled"',
    });
  });

  it("keeps the guard on when the path cannot be read as a file", () => {
    const directory = mkdtempSync(join(tmpdir(), "command-guard-config-"));
    mkdirSync(join(directory, CONFIG_FILE_NAME));
    const config = readGuardConfig(directory);
    expect(config.mode).toBe("on-after-error");
    expect(guardConfigStatus(config)).toContain("keeps the guard on: cannot read it");
  });

  it("describes each mode in one status line", () => {
    expect(guardConfigStatus({ mode: "on" })).toBeUndefined();
    expect(guardConfigStatus({ mode: "off", path: "f" })).toBe(
      'f sets "enabled": false, so the extension loads no checks on this machine.',
    );
  });
});

describe("Command Guard turned off by the config file", () => {
  it("registers only the status command and no guard hooks", async () => {
    const { commands, on, pi } = fakePi();
    registerCommandGuard(pi, { mode: "off", path: "/agent/.command-guard.json" });
    expect(on).not.toHaveBeenCalled();
    expect([...commands.keys()]).toEqual(["command-guard"]);

    const notify = vi.fn();
    await commands.get("command-guard")?.handler("on", { ui: { notify } });
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('/agent/.command-guard.json sets "enabled": false'),
      "warning",
    );
  });

  it("loads the guard and reports a broken file in the status", async () => {
    const { commands, on, pi } = fakePi();
    registerCommandGuard(pi, { mode: "on-after-error", path: "f", error: "not valid JSON" });
    expect(on).toHaveBeenCalled();

    const notify = vi.fn();
    await commands.get("command-guard")?.handler("off", { ui: { notify } });
    await commands.get("command-guard")?.handler("status", { ui: { notify } });
    expect(notify).toHaveBeenLastCalledWith(
      expect.stringContaining("f keeps the guard on: not valid JSON."),
      "warning",
    );
  });
});
