import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BashOperations, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  commandEnvironmentEvent,
  throwIfCommandEnvironmentRejected,
} from "@onurpi/unified-exec/command-environment";
import { commandInputEvent, throwIfCommandInputRejected } from "@onurpi/unified-exec/command-input";
import { runFinalInputPolicies, runFinalSpawnPolicies } from "@onurpi/unified-exec/command-policy";

import commandGuard from "../index.ts";
import { guardedOperations } from "../src/builtins.ts";
import { ExecutionCheckStore } from "../src/execution-check.ts";
import { createGuardState, guardSwitchStatus } from "../src/state.ts";
import { registerUnifiedExecGuards } from "../src/unified-adapter.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;
type CommandContext = { ui: { notify: (text: string, level: string) => void } };
type CommandDefinition = {
  description: string;
  handler: (args: string, ctx: CommandContext) => Promise<void> | void;
};
type GuidanceResult = { systemPrompt: string } | undefined;

function fakePi() {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, CommandDefinition>();
  const notify = vi.fn();
  const setActiveTools = vi.fn();
  const pi = {
    getActiveTools: () => ["bash", "exec_command"],
    getAllTools: () => [],
    notify,
    on: (event: string, handler: unknown) => {
      handlers.set(event, handler as Handler);
    },
    registerCommand: (name: string, definition: unknown) => {
      commands.set(name, definition as CommandDefinition);
    },
    registerTool: vi.fn(),
    setActiveTools,
    ui: { notify },
  };
  commandGuard(pi as unknown as ExtensionAPI);
  const command = (args: string) => {
    const definition = commands.get("command-guard");
    if (!definition) throw new Error("command-guard command is not registered");
    return definition.handler(args, { ui: { notify } });
  };
  const toolCall = (input: Record<string, unknown>, toolName = "exec_command") => {
    const handler = handlers.get("tool_call");
    if (!handler) throw new Error("tool_call handler is not registered");
    return handler({ input, toolCallId: "call", toolName }, { cwd: process.cwd() });
  };
  const userBash = () => {
    const handler = handlers.get("user_bash");
    if (!handler) throw new Error("user_bash handler is not registered");
    return handler({}, {}) as { operations: BashOperations };
  };
  const toolExecutionEnd = () => {
    const handler = handlers.get("tool_execution_end");
    if (!handler) throw new Error("tool_execution_end handler is not registered");
    return handler({ toolCallId: "call" }, {});
  };
  const beforeAgentStart = (): GuidanceResult => {
    const handler = handlers.get("before_agent_start");
    if (!handler) throw new Error("before_agent_start handler is not registered");
    return handler({ systemPrompt: "core prompt" }, {}) as GuidanceResult;
  };
  return { beforeAgentStart, command, notify, pi, toolCall, toolExecutionEnd, userBash };
}

let directory = "";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "command-guard-switch-"));
});

describe("Command Guard switch", () => {
  it("passes final Unified Exec checks while off", () => {
    const state = createGuardState();
    const stop = registerUnifiedExecGuards(new ExecutionCheckStore(), state);
    const spawn = commandEnvironmentEvent(
      "unchecked",
      "invocation",
      "echo safe",
      directory,
      "bash",
      undefined,
      process.env,
    );
    const input = commandInputEvent(
      "unchecked-input",
      1,
      "cat",
      directory,
      "bash",
      true,
      new TextEncoder().encode("text"),
    );
    try {
      state.enabled = false;
      runFinalSpawnPolicies(spawn);
      runFinalInputPolicies(input);
      expect(() => {
        throwIfCommandEnvironmentRejected(spawn);
      }).not.toThrow();
      expect(() => {
        throwIfCommandInputRejected(input);
      }).not.toThrow();

      state.enabled = true;
      runFinalSpawnPolicies(spawn);
      expect(() => {
        throwIfCommandEnvironmentRejected(spawn);
      }).toThrow("command guard");
    } finally {
      stop();
    }
  });

  it("starts enabled and says so in the status line", () => {
    const state = createGuardState();

    expect(state.enabled).toBe(true);
    expect(guardSwitchStatus(state)).toContain("Switch: on");
  });

  it("blocks a protected target while on and passes it through after off", async () => {
    const { command, toolCall } = fakePi();
    const input = { cmd: "rm -rf .", shell: "bash" };

    await expect(toolCall(input)).resolves.toMatchObject({ block: true });

    await command("off");
    await expect(toolCall(input)).resolves.toBeUndefined();

    await command("on");
    await expect(toolCall(input)).resolves.toMatchObject({ block: true });
  });

  it("runs shell operations unchecked while off", async () => {
    const state = createGuardState();
    const exec = vi.fn(() => Promise.resolve({ exitCode: 0 }));
    const operations = guardedOperations({ exec }, "bash", new ExecutionCheckStore(), state);
    const options = { env: process.env, onData: vi.fn() };

    state.enabled = false;
    await expect(operations.exec("rm -rf .", directory, options)).resolves.toEqual({ exitCode: 0 });
    expect(exec).toHaveBeenCalledOnce();

    state.enabled = true;
    await expect(operations.exec("rm -rf .", directory, options)).rejects.toThrow("command guard");
    expect(exec).toHaveBeenCalledOnce();
  });

  it("blocks command text on a tool without a final adapter", async () => {
    const { command, toolCall } = fakePi();

    await expect(toolCall({ command: "rm -rf ." }, "bash")).resolves.toBeUndefined();
    await expect(toolCall({ chars: "rm -rf .\r" }, "write_stdin")).resolves.toMatchObject({
      block: true,
    });
    await expect(toolCall({ cmd: "echo hi" }, "custom_cmd")).resolves.toMatchObject({
      block: true,
    });

    await command("off");

    await expect(toolCall({ cmd: "echo hi" }, "custom_cmd")).resolves.toBeUndefined();
  });

  it("switches direct bash commands with the same switch", async () => {
    const { command, toolExecutionEnd, userBash } = fakePi();
    const options = { env: process.env, onData: vi.fn() };

    await expect(userBash().operations.exec("rm -rf .", directory, options)).rejects.toThrow(
      "command guard",
    );

    await command("off");

    await expect(
      userBash().operations.exec("echo switch-check", directory, options),
    ).resolves.toMatchObject({ exitCode: 0 });
    expect(toolExecutionEnd()).toBeUndefined();
  });

  it("reports the switch as off in the status text", async () => {
    const { command, notify } = fakePi();

    await command("off");
    await command("");
    await command("status");

    const texts = notify.mock.calls.map((call) => String(call[0]));
    expect(texts[0]).toContain("off for this session");
    expect(texts[1]).toContain("off for this session");
    expect(texts[2]).toContain("Switch: off for this session");
    expect(texts[2]).not.toContain("Command Guard is active.");
  });

  it("keeps the guard on for an unknown argument", async () => {
    const { command, notify, toolCall } = fakePi();

    await command("maybe");

    expect(notify).toHaveBeenCalledWith("Usage: /command-guard [status|on|off]", "error");
    await expect(toolCall({ cmd: "rm -rf .", shell: "bash" })).resolves.toMatchObject({
      block: true,
    });
  });

  it("drops the system prompt guidance while off", async () => {
    const { beforeAgentStart, command } = fakePi();

    expect(beforeAgentStart()?.systemPrompt).toContain("Keep the guard enabled");

    await command("off");

    expect(beforeAgentStart()).toBeUndefined();
  });

  it("starts a fresh session with the guard on", async () => {
    const { command, toolCall } = fakePi();

    await command("off");
    await command("on");

    await expect(toolCall({ cmd: "rm -rf .", shell: "bash" })).resolves.toMatchObject({
      block: true,
    });
  });
});
