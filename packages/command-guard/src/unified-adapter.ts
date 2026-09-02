import {
  registerFinalCommandPolicy,
  type FinalCommandEnvironmentRequest,
  type FinalCommandInputRequest,
} from "@onurpi/unified-exec/command-policy";
import { ApprovalStore } from "./approval.ts";
import { commandContext } from "./contexts.ts";
import { isCommandEnvironmentEvent, isCommandInputEvent, isControlOnlyInput } from "./events.ts";

function finalEnvironmentError(
  value: FinalCommandEnvironmentRequest,
  approvals: ApprovalStore,
): string | undefined {
  const context = commandContext({
    command: value.command,
    cwd: value.cwd,
    environment: { ...value.environment },
    shell: value.shell,
  });
  return approvals.consume(value.toolCallId, context)
    ? undefined
    : "command guard: final command does not match an approved tool call";
}

function finalInputError(value: FinalCommandInputRequest): string | undefined {
  return isControlOnlyInput(Uint8Array.from(value.bytes))
    ? undefined
    : "command guard: non-control input is blocked because its effect cannot be checked";
}

export function handleCommandEnvironment(value: unknown, approvals: ApprovalStore): void {
  if (!isCommandEnvironmentEvent(value)) return;
  try {
    const error = finalEnvironmentError(value, approvals);
    if (error) value.reject(new Error(error));
  } catch (error: unknown) {
    value.reject(error);
  }
}

export function handleCommandInput(value: unknown): void {
  if (!isCommandInputEvent(value)) return;
  try {
    const request: FinalCommandInputRequest = {
      toolCallId: value.toolCallId,
      sessionId: value.sessionId,
      command: value.command,
      cwd: value.cwd,
      shell: value.shell,
      tty: value.tty,
      bytes: [...value.bytes],
    };
    const error = finalInputError(request);
    if (error) value.reject(new Error(error));
  } catch (error: unknown) {
    value.reject(error);
  }
}

export function registerUnifiedExecGuards(approvals: ApprovalStore): () => void {
  return registerFinalCommandPolicy({
    checkSpawn: (request) => finalEnvironmentError(request, approvals),
    checkInput: finalInputError,
  });
}
