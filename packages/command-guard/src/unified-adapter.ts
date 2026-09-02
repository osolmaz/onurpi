import {
  registerFinalCommandPolicy,
  type FinalCommandEnvironmentRequest,
  type FinalCommandInputRequest,
} from "@onurpi/unified-exec/command-policy";
import { ExecutionCheckStore } from "./execution-check.ts";
import { commandContext } from "./contexts.ts";
import { isCommandEnvironmentEvent, isCommandInputEvent, isControlOnlyInput } from "./events.ts";

function finalEnvironmentError(
  value: FinalCommandEnvironmentRequest,
  checks: ExecutionCheckStore,
): string | undefined {
  const context = commandContext({
    command: value.command,
    cwd: value.cwd,
    environment: { ...value.environment },
    shell: value.shell,
  });
  return checks.consume(value.toolCallId, context)
    ? undefined
    : "command guard: final command does not match the checked tool call";
}

function finalInputError(value: FinalCommandInputRequest): string | undefined {
  return isControlOnlyInput(Uint8Array.from(value.bytes))
    ? undefined
    : "command guard: non-control input is blocked because its effect cannot be checked";
}

export function handleCommandEnvironment(value: unknown, checks: ExecutionCheckStore): void {
  if (!isCommandEnvironmentEvent(value)) return;
  try {
    const error = finalEnvironmentError(value, checks);
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

export function registerUnifiedExecGuards(checks: ExecutionCheckStore): () => void {
  return registerFinalCommandPolicy({
    checkSpawn: (request) => finalEnvironmentError(request, checks),
    checkInput: finalInputError,
  });
}
