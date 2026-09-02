import { randomUUID } from "node:crypto";

import {
  createBashToolDefinition,
  createLocalBashOperations,
  createLocalPowerShellOperations,
  createPowerShellToolDefinition,
  type BashOperations,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

import { ApprovalStore } from "./approval.ts";
import { authorizeCommand, type ApprovalContext } from "./authorize.ts";
import { commandContext } from "./contexts.ts";

export function guardedOperations(
  operations: BashOperations,
  shell: string,
  extensionContext: ApprovalContext,
  approvals: ApprovalStore,
): BashOperations {
  return {
    async exec(command, cwd, options) {
      const context = commandContext({
        command,
        cwd,
        environment: options.env ?? process.env,
        shell,
      });
      const authorization = await authorizeCommand(context, extensionContext);
      if (!authorization.allowed) {
        throw new Error(`command guard: ${authorization.reason ?? "command blocked"}`);
      }
      const invocationId = randomUUID();
      approvals.remember(invocationId, context, authorization.decision);
      if (!approvals.consume(invocationId, context)) {
        throw new Error("command guard: final command check failed");
      }
      return operations.exec(command, cwd, options);
    },
  };
}

function registerBashOverride(pi: ExtensionAPI, approvals: ApprovalStore): void {
  const template = createBashToolDefinition(process.cwd());
  pi.registerTool({
    ...template,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tool = createBashToolDefinition(ctx.cwd, {
        operations: guardedOperations(createLocalBashOperations(), "bash", ctx, approvals),
      });
      return tool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
}

function registerPowerShellOverride(pi: ExtensionAPI, approvals: ApprovalStore): void {
  const template = createPowerShellToolDefinition(process.cwd());
  pi.registerTool({
    ...template,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tool = createPowerShellToolDefinition(ctx.cwd, {
        operations: guardedOperations(
          createLocalPowerShellOperations(),
          "powershell",
          ctx,
          approvals,
        ),
      });
      return tool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
}

export function registerShellGuards(pi: ExtensionAPI, approvals: ApprovalStore): void {
  registerBashOverride(pi, approvals);
  registerPowerShellOverride(pi, approvals);
  pi.on("user_bash", (_event, ctx) => ({
    operations: guardedOperations(createLocalBashOperations(), "bash", ctx, approvals),
  }));
}
