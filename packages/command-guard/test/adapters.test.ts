import { mkdtempSync, renameSync, writeFileSync } from "node:fs";
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
import { ApprovalStore } from "../src/approval.ts";
import { authorizeCommand, type ApprovalContext } from "../src/authorize.ts";
import { guardedOperations } from "../src/builtins.ts";
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

function approvalContext(
  confirmed: boolean,
  hasUI = true,
  onConfirm?: () => void,
): ApprovalContext & Readonly<{ cwd: string }> {
  return {
    cwd: directory,
    hasUI,
    signal: undefined,
    ui: {
      confirm: vi.fn(() => {
        onConfirm?.();
        return Promise.resolve(confirmed);
      }),
    },
  };
}

describe("approval UI", () => {
  it("allows safe commands without a prompt", async () => {
    const ctx = approvalContext(false);
    const result = await authorizeCommand(
      commandContext({ command: "echo safe", cwd: directory, shell: "bash" }),
      ctx,
    );
    expect(result.allowed).toBe(true);
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("requires a positive UI response for destructive commands", async () => {
    const command = commandContext({ command: "rm -f file", cwd: directory, shell: "bash" });
    await expect(authorizeCommand(command, approvalContext(true))).resolves.toMatchObject({
      allowed: true,
    });
    await expect(authorizeCommand(command, approvalContext(false))).resolves.toMatchObject({
      allowed: false,
      reason: "destructive command was not approved",
    });
    const unavailable = await authorizeCommand(command, approvalContext(true, false));
    expect(unavailable.allowed).toBe(false);
    expect(unavailable.reason).toContain("approval UI is unavailable");
  });

  it("rejects a target that changes during approval", async () => {
    const path = join(directory, "drift");
    writeFileSync(path, "first");
    const ctx = approvalContext(true, true, () => {
      const replaced = `${path}.old`;
      renameSync(path, replaced);
      writeFileSync(path, "second");
    });
    const result = await authorizeCommand(
      commandContext({ command: "rm -f drift", cwd: directory, shell: "bash" }),
      ctx,
    );
    expect(result).toMatchObject({
      allowed: false,
      reason: "destructive target changed before execution",
    });
  });

  it("does not offer approval for a critical target", async () => {
    const ctx = approvalContext(true);
    const result = await authorizeCommand(
      commandContext({ command: "rm -rf .", cwd: directory, shell: "bash" }),
      ctx,
    );
    expect(result).toMatchObject({ allowed: false });
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });
});

describe("final shell operation", () => {
  it("delegates only after the final command passes", async () => {
    const exec = vi.fn(() => Promise.resolve({ exitCode: 0 }));
    const operations = guardedOperations(
      { exec },
      "bash",
      approvalContext(true),
      new ApprovalStore(),
    );
    const options = { onData: vi.fn(), env: process.env };
    await expect(operations.exec("rm -f file", directory, options)).resolves.toEqual({
      exitCode: 0,
    });
    expect(exec).toHaveBeenCalledOnce();

    const blockedExec = vi.fn(() => Promise.resolve({ exitCode: 0 }));
    const blocked = guardedOperations(
      { exec: blockedExec },
      "bash",
      approvalContext(false),
      new ApprovalStore(),
    );
    await expect(blocked.exec("rm -f file", directory, options)).rejects.toThrow("command guard");
    expect(blockedExec).not.toHaveBeenCalled();
  });
});

describe("unified-exec adapter", () => {
  it("binds the early tool decision to the final spawn event", async () => {
    const approvals = new ApprovalStore();
    const early = await guardExecCommand(
      { toolCallId: "call", input: { cmd: "echo safe", workdir: directory, shell: "bash" } },
      approvalContext(false),
      approvals,
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
    handleCommandEnvironment(event, approvals);
    expect(() => {
      throwIfCommandEnvironmentRejected(event);
    }).not.toThrow();
    expect(approvals.size).toBe(0);
  });

  it("rejects a changed, injected, or unapproved final spawn", async () => {
    const approvals = new ApprovalStore();
    await guardExecCommand(
      { toolCallId: "changed", input: { cmd: "echo safe" } },
      approvalContext(false),
      approvals,
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
    handleCommandEnvironment(changed, approvals);
    expect(() => {
      throwIfCommandEnvironmentRejected(changed);
    }).toThrow("does not match");

    await guardExecCommand(
      { toolCallId: "injected", input: { cmd: "echo safe" } },
      approvalContext(false),
      approvals,
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
    handleCommandEnvironment(injected, approvals);
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
    handleCommandEnvironment(missing, approvals);
    expect(() => {
      throwIfCommandEnvironmentRejected(missing);
    }).toThrow("does not match");
    expect(() => {
      handleCommandEnvironment({}, approvals);
    }).not.toThrow();
  });

  it("blocks unsafe or unclear exec_command requests early", async () => {
    const approvals = new ApprovalStore();
    await expect(
      guardExecCommand({ toolCallId: "missing", input: {} }, approvalContext(true), approvals),
    ).resolves.toMatchObject({ block: true });
    await expect(
      guardExecCommand(
        { toolCallId: "delete", input: { cmd: "rm -f file" } },
        approvalContext(false),
        approvals,
      ),
    ).resolves.toMatchObject({ block: true });
  });
});

describe("unified-exec final adapter", () => {
  it("registers final policies after all event listeners", async () => {
    const approvals = new ApprovalStore();
    await guardExecCommand(
      { toolCallId: "registered", input: { cmd: "echo safe", shell: "bash" } },
      approvalContext(false),
      approvals,
    );
    const stop = registerUnifiedExecGuards(approvals);
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
