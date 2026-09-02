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

export function guardedOperations(
  operations: BashOperations,
  shell: string,
  checks: ExecutionCheckStore,
): BashOperations {
  return {
    async exec(command, cwd, options) {
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

function registerBashOverride(pi: ExtensionAPI, checks: ExecutionCheckStore): void {
  const template = createBashToolDefinition(process.cwd());
  pi.registerTool({
    ...template,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tool = createBashToolDefinition(ctx.cwd, {
        operations: guardedOperations(createLocalBashOperations(), "bash", checks),
      });
      return tool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
}

function registerPowerShellOverride(pi: ExtensionAPI, checks: ExecutionCheckStore): void {
  const template = createPowerShellToolDefinition(process.cwd());
  pi.registerTool({
    ...template,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tool = createPowerShellToolDefinition(ctx.cwd, {
        operations: guardedOperations(createLocalPowerShellOperations(), "powershell", checks),
      });
      return tool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
}

export function registerShellGuards(pi: ExtensionAPI, checks: ExecutionCheckStore): void {
  registerBashOverride(pi, checks);
  registerPowerShellOverride(pi, checks);
  pi.on("user_bash", () => ({
    operations: guardedOperations(createLocalBashOperations(), "bash", checks),
  }));
}
