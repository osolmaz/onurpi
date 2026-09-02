import type { ExtensionAPI, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { resolveCommandShell } from "@onurpi/unified-exec/command-shell";

import { AdapterCoverage, commandField } from "./adapters.ts";
import { checkCommand } from "./decision.ts";
import { ExecutionCheckStore } from "./execution-check.ts";
import { commandContext } from "./contexts.ts";
import { isControlOnlyInput, resolveCommandInput } from "./events.ts";

function block(reason: string): ToolCallEventResult {
  return { block: true, reason: `command guard: ${reason}` };
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

export async function guardExecCommand(
  event: Readonly<{
    toolCallId: string;
    input: Record<string, unknown>;
  }>,
  ctx: Readonly<{ cwd: string }>,
  checks: ExecutionCheckStore,
): Promise<ToolCallEventResult | undefined> {
  const command = optionalString(event.input, "cmd");
  if (command === undefined) return block("exec_command has no exact command text");
  const workdir = optionalString(event.input, "workdir");
  const shell = resolveCommandShell(optionalString(event.input, "shell"));
  const context = commandContext({
    command,
    cwd: workdir?.length ? workdir : ctx.cwd,
    environment: process.env,
    shell,
  });
  const result = await checkCommand(context);
  if (!result.allowed) return block(result.reason ?? "command blocked");
  checks.remember(event.toolCallId, context, result.decision);
  return undefined;
}

export function guardWriteStdin(input: Record<string, unknown>): ToolCallEventResult | undefined {
  let bytes: Uint8Array | undefined;
  try {
    bytes = resolveCommandInput({
      chars: optionalString(input, "chars"),
      chars_b64: optionalString(input, "chars_b64"),
    });
  } catch (error: unknown) {
    return block(error instanceof Error ? error.message : String(error));
  }
  if (!bytes?.length || isControlOnlyInput(bytes)) return undefined;
  return block(
    "non-control input to a running process is blocked because its effect cannot be checked",
  );
}

export function registerToolCallGuards(
  pi: ExtensionAPI,
  checks: ExecutionCheckStore,
  coverage: AdapterCoverage,
): void {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "exec_command") {
      return guardExecCommand(event, ctx, checks);
    }
    if (event.toolName === "write_stdin") return guardWriteStdin(event.input);
    if (event.toolName === "bash" || event.toolName === "powershell") return undefined;
    if (!coverage.isGuarded(event.toolName) && commandField(event.input) !== undefined) {
      return block(`tool ${event.toolName} has command text but no final execution adapter`);
    }
    return undefined;
  });
  pi.on("tool_execution_end", (event) => {
    checks.discard(event.toolCallId);
  });
}
