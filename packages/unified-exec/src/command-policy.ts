import type { CommandEnvironmentEvent } from "./command-environment.ts";
import type { CommandInputEvent } from "./command-input.ts";

export type FinalCommandEnvironmentRequest = Readonly<{
  toolCallId: string;
  invocationId: string;
  command: string;
  cwd: string;
  shell: string;
  environment: Readonly<NodeJS.ProcessEnv>;
}>;

export type FinalCommandInputRequest = Readonly<{
  toolCallId: string;
  sessionId: number;
  command: string;
  cwd: string;
  shell: string;
  tty: boolean;
  bytes: readonly number[];
}>;

export type FinalCommandPolicy = Readonly<{
  checkSpawn(request: FinalCommandEnvironmentRequest): Error | string | undefined;
  checkInput(request: FinalCommandInputRequest): Error | string | undefined;
}>;

const policies = new Set<FinalCommandPolicy>();

export function registerFinalCommandPolicy(policy: FinalCommandPolicy): () => void {
  policies.add(policy);
  return () => {
    policies.delete(policy);
  };
}

function rejection(value: Error | string): Error {
  return value instanceof Error ? value : new Error(value);
}

export function runFinalSpawnPolicies(event: CommandEnvironmentEvent): void {
  const request: FinalCommandEnvironmentRequest = Object.freeze({
    toolCallId: event.toolCallId,
    invocationId: event.invocationId,
    command: event.command,
    cwd: event.cwd,
    shell: event.shell,
    environment: Object.freeze({ ...event.environment }),
  });
  for (const policy of policies) {
    try {
      const result = policy.checkSpawn(request);
      if (result) event.reject(rejection(result));
    } catch (error: unknown) {
      event.reject(error);
    }
  }
}

export function runFinalInputPolicies(event: CommandInputEvent): void {
  const request: FinalCommandInputRequest = Object.freeze({
    toolCallId: event.toolCallId,
    sessionId: event.sessionId,
    command: event.command,
    cwd: event.cwd,
    shell: event.shell,
    tty: event.tty,
    bytes: Object.freeze([...event.bytes]),
  });
  for (const policy of policies) {
    try {
      const result = policy.checkInput(request);
      if (result) event.reject(rejection(result));
    } catch (error: unknown) {
      event.reject(error);
    }
  }
}
