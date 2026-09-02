import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  commandEnvironmentEvent,
  throwIfCommandEnvironmentRejected,
} from "@onurpi/unified-exec/command-environment";
import { commandInputEvent, throwIfCommandInputRejected } from "@onurpi/unified-exec/command-input";
import { runFinalInputPolicies, runFinalSpawnPolicies } from "@onurpi/unified-exec/command-policy";

import { AdapterCoverage } from "../src/adapters.ts";
import { guardedOperations } from "../src/builtins.ts";
import { checkCommand } from "../src/decision.ts";
import { ExecutionCheckStore } from "../src/execution-check.ts";
import { commandContext } from "../src/contexts.ts";
import { guardExecCommand, guardWriteStdin } from "../src/tool-calls.ts";
import {
  handleCommandEnvironment,
  handleCommandInput,
  registerUnifiedExecGuards,
} from "../src/unified-adapter.ts";

let directory = "";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "command-guard-adapter-"));
  writeFileSync(join(directory, "file"), "data");
});

function guardContext(): Readonly<{ cwd: string }> {
  return { cwd: directory };
}

describe("command decision", () => {
  it("allows safe commands and exact non-critical deletions without a prompt", async () => {
    await expect(
      checkCommand(commandContext({ command: "echo safe", cwd: directory, shell: "bash" })),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      checkCommand(commandContext({ command: "rm -f file", cwd: directory, shell: "bash" })),
    ).resolves.toMatchObject({ allowed: true });
  });

  it("blocks critical targets", async () => {
    await expect(
      checkCommand(commandContext({ command: "rm -rf .", cwd: directory, shell: "bash" })),
    ).resolves.toMatchObject({ allowed: false });
  });
});

describe("final shell operation", () => {
  it("delegates exact non-critical deletion but not a blocked command", async () => {
    const exec = vi.fn(() => Promise.resolve({ exitCode: 0 }));
    const operations = guardedOperations({ exec }, "bash", new ExecutionCheckStore());
    const options = { onData: vi.fn(), env: process.env };
    await expect(operations.exec("rm -f file", directory, options)).resolves.toEqual({
      exitCode: 0,
    });
    expect(exec).toHaveBeenCalledOnce();

    const blockedExec = vi.fn(() => Promise.resolve({ exitCode: 0 }));
    const blocked = guardedOperations({ exec: blockedExec }, "bash", new ExecutionCheckStore());
    await expect(blocked.exec("rm -rf .", directory, options)).rejects.toThrow("command guard");
    expect(blockedExec).not.toHaveBeenCalled();
  });
});

describe("unified-exec adapter", () => {
  it("binds the early tool decision to the final spawn event", async () => {
    const checks = new ExecutionCheckStore();
    const early = await guardExecCommand(
      { toolCallId: "call", input: { cmd: "echo safe", workdir: directory, shell: "bash" } },
      guardContext(),
      checks,
    );
    expect(early).toBeUndefined();
    const event = commandEnvironmentEvent(
      "call",
      "invocation",
      "echo safe",
      directory,
      "bash",
      undefined,
      process.env,
    );
    handleCommandEnvironment(event, checks);
    expect(() => {
      throwIfCommandEnvironmentRejected(event);
    }).not.toThrow();
    expect(checks.size).toBe(0);
  });

  it("rejects a changed, injected, or unchecked final spawn", async () => {
    const checks = new ExecutionCheckStore();
    await guardExecCommand(
      { toolCallId: "changed", input: { cmd: "echo safe" } },
      guardContext(),
      checks,
    );
    const changed = commandEnvironmentEvent(
      "changed",
      "invocation",
      "echo changed",
      directory,
      "bash",
      undefined,
      process.env,
    );
    handleCommandEnvironment(changed, checks);
    expect(() => {
      throwIfCommandEnvironmentRejected(changed);
    }).toThrow("does not match");

    await guardExecCommand(
      { toolCallId: "injected", input: { cmd: "echo safe" } },
      guardContext(),
      checks,
    );
    const injected = commandEnvironmentEvent(
      "injected",
      "invocation",
      "echo safe",
      directory,
      "bash",
      undefined,
      { ...process.env, LD_PRELOAD: "/tmp/injected.so" },
    );
    handleCommandEnvironment(injected, checks);
    expect(() => {
      throwIfCommandEnvironmentRejected(injected);
    }).toThrow("does not match");

    const missing = commandEnvironmentEvent(
      "missing",
      "invocation",
      "echo safe",
      directory,
      "bash",
      undefined,
      process.env,
    );
    handleCommandEnvironment(missing, checks);
    expect(() => {
      throwIfCommandEnvironmentRejected(missing);
    }).toThrow("does not match");
    expect(() => {
      handleCommandEnvironment({}, checks);
    }).not.toThrow();
  });

  it("allows exact non-critical deletion but blocks unsafe or unclear requests", async () => {
    const checks = new ExecutionCheckStore();
    await expect(
      guardExecCommand({ toolCallId: "missing", input: {} }, guardContext(), checks),
    ).resolves.toMatchObject({ block: true });
    await expect(
      guardExecCommand(
        { toolCallId: "delete", input: { cmd: "rm -f file" } },
        guardContext(),
        checks,
      ),
    ).resolves.toBeUndefined();
    await expect(
      guardExecCommand(
        { toolCallId: "critical", input: { cmd: "rm -rf ." } },
        guardContext(),
        checks,
      ),
    ).resolves.toMatchObject({ block: true });
  });
});

describe("unified-exec final adapter", () => {
  it("registers final policies after all event listeners", async () => {
    const checks = new ExecutionCheckStore();
    await guardExecCommand(
      { toolCallId: "registered", input: { cmd: "echo safe", shell: "bash" } },
      guardContext(),
      checks,
    );
    const stop = registerUnifiedExecGuards(checks);
    try {
      const spawn = commandEnvironmentEvent(
        "registered",
        "invocation",
        "echo safe",
        directory,
        "bash",
        undefined,
        process.env,
      );
      runFinalSpawnPolicies(spawn);
      expect(() => {
        throwIfCommandEnvironmentRejected(spawn);
      }).not.toThrow();

      const input = commandInputEvent(
        "registered-input",
        1,
        "cat",
        directory,
        "bash",
        true,
        new TextEncoder().encode("text"),
      );
      runFinalInputPolicies(input);
      expect(() => {
        throwIfCommandInputRejected(input);
      }).toThrow("non-control input");
    } finally {
      stop();
    }
  });

  it("allows polls and control input but blocks other process input", () => {
    expect(guardWriteStdin({})).toBeUndefined();
    expect(guardWriteStdin({ chars: "\\x03" })).toBeUndefined();
    expect(guardWriteStdin({ chars_b64: "Aw==" })).toBeUndefined();
    expect(guardWriteStdin({ chars: "rm -rf target\\r" })).toMatchObject({ block: true });
    expect(guardWriteStdin({ chars: "x", chars_b64: "eA==" })).toMatchObject({ block: true });

    const control = commandInputEvent(
      "input",
      1,
      "cat",
      directory,
      "bash",
      true,
      new Uint8Array([3]),
    );
    handleCommandInput(control);
    expect(() => {
      throwIfCommandInputRejected(control);
    }).not.toThrow();

    const text = commandInputEvent(
      "input",
      1,
      "cat",
      directory,
      "bash",
      true,
      new TextEncoder().encode("text"),
    );
    handleCommandInput(text);
    expect(() => {
      throwIfCommandInputRejected(text);
    }).toThrow("non-control input");
    expect(() => {
      handleCommandInput({});
    }).not.toThrow();
  });
});

describe("adapter coverage", () => {
  it("removes active command-shaped tools without a final adapter", () => {
    let active = ["read", "remote-shell", "exec_command"];
    const coverage = new AdapterCoverage({
      getAllTools: () => [
        { name: "read", parameters: { properties: { path: {} } } },
        { name: "remote-shell", parameters: { properties: { command: {} } } },
        { name: "exec_command", parameters: { properties: { cmd: {} } } },
      ],
      getActiveTools: () => active,
      setActiveTools: (names) => {
        active = names;
      },
    });
    coverage.enforce();
    expect(active).toEqual(["read", "exec_command"]);
    expect(coverage.disabled).toEqual(["remote-shell"]);
    expect(coverage.isGuarded("exec_command")).toBe(true);
    expect(coverage.isGuarded("remote-shell")).toBe(false);
  });
});
