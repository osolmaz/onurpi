import { randomUUID } from "node:crypto";

import {
  createBashToolDefinition,
  createLocalBashOperations,
  createLocalPowerShellOperations,
  createPowerShellToolDefinition,
  type BashOperations,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

import { checkCommand } from "./decision.ts";
import { ExecutionCheckStore } from "./execution-check.ts";
import { commandContext } from "./contexts.ts";
import { supportsPowerShellTool } from "./shell.ts";
import type { GuardState } from "./state.ts";

export function guardedOperations(
  operations: BashOperations,
  shell: string,
  checks: ExecutionCheckStore,
  state: GuardState,
): BashOperations {
  return {
    async exec(command, cwd, options) {
      if (!state.enabled) return operations.exec(command, cwd, options);
      const context = commandContext({
        command,
        cwd,
        environment: options.env ?? process.env,
        shell,
      });
      const result = await checkCommand(context);
      if (!result.allowed) {
        throw new Error(`command guard: ${result.reason ?? "command blocked"}`);
      }
      const invocationId = randomUUID();
      checks.remember(invocationId, context, result.decision);
      if (!checks.consume(invocationId, context)) {
        throw new Error("command guard: final command check failed");
      }
      return operations.exec(command, cwd, options);
    },
  };
}

type ShellGuardAPI = Pick<ExtensionAPI, "registerTool" | "on">;

function registerBashOverride(
  pi: ShellGuardAPI,
  checks: ExecutionCheckStore,
  state: GuardState,
): void {
  const template = createBashToolDefinition(process.cwd());
  pi.registerTool({
    ...template,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tool = createBashToolDefinition(ctx.cwd, {
        operations: guardedOperations(createLocalBashOperations(), "bash", checks, state),
      });
      return tool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
}

function registerPowerShellOverride(
  pi: ShellGuardAPI,
  checks: ExecutionCheckStore,
  state: GuardState,
): void {
  const template = createPowerShellToolDefinition(process.cwd());
  pi.registerTool({
    ...template,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tool = createPowerShellToolDefinition(ctx.cwd, {
        operations: guardedOperations(
          createLocalPowerShellOperations(),
          "powershell",
          checks,
          state,
        ),
      });
      return tool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
}

export function registerShellGuards(
  pi: ShellGuardAPI,
  checks: ExecutionCheckStore,
  state: GuardState,
): void {
  registerBashOverride(pi, checks, state);
  if (supportsPowerShellTool()) registerPowerShellOverride(pi, checks, state);
  pi.on("user_bash", () => ({
    operations: guardedOperations(createLocalBashOperations(), "bash", checks, state),
  }));
}
