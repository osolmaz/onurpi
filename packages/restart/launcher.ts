import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

import {
  analyzeRestartArguments,
  replacementArguments,
  type RestartArgumentPolicy,
} from "./arguments.ts";
import {
  resolvePiEntrypoint,
  startPiWorker,
  type PiWorker,
  type StartWorker,
  type WorkerExit,
} from "./pi-process.ts";
import {
  EXPECTED_CWD_ENV,
  EXPECTED_SESSION_FILE_ENV,
  EXPECTED_SESSION_ID_ENV,
  parseLauncherInboundMessage,
  RESTART_GENERATION_ENV,
  RESTART_PROTOCOL_ENV,
  RESTART_PROTOCOL_SCHEMA,
  restartAccepted,
  restartRejected,
  type RestartRequest,
  type RuntimeReady,
} from "./protocol.ts";
import { recoveryMessage } from "./recovery.ts";
import { readSessionHeader } from "./session-header.ts";

export type LauncherDependencies = {
  startWorker: StartWorker;
  resolveEntrypoint(): string;
  createGeneration(): string;
  readHeader(path: string): { id: string; cwd: string };
  stat(path: string): { isFile(): boolean; isDirectory(): boolean };
  writeError(message: string): void;
  onWorker(worker: PiWorker | undefined): void;
  shouldStop(): boolean;
  env: NodeJS.ProcessEnv;
  cwd: string;
};

type GenerationResult = {
  exit: WorkerExit;
  accepted?: RestartRequest;
  ready: boolean;
};

type GenerationContext = {
  generation: string;
  entrypoint: string;
  policy: RestartArgumentPolicy;
  launchCwd: string;
  expected?: RestartRequest;
};

function defaultDependencies(): LauncherDependencies {
  return {
    startWorker: startPiWorker,
    resolveEntrypoint: () => resolvePiEntrypoint(),
    createGeneration: randomUUID,
    readHeader: readSessionHeader,
    stat: statSync,
    writeError: (message) => {
      process.stderr.write(`${message}\n`);
    },
    onWorker: () => undefined,
    shouldStop: () => false,
    env: process.env,
    cwd: process.cwd(),
  };
}

function requestShapeError(
  request: RestartRequest,
  context: GenerationContext,
): string | undefined {
  if (request.generation !== context.generation) return "Restart generation does not match.";
  if (!context.policy.supported) return context.policy.reason;
  if (!isAbsolute(request.sessionFile) || !isAbsolute(request.cwd)) {
    return "Session file and working directory must be absolute paths.";
  }
  if (request.cwd !== context.launchCwd) return "Working directory does not match the Pi launch.";
  return undefined;
}

function requestResourceError(
  request: RestartRequest,
  context: GenerationContext,
  deps: LauncherDependencies,
): string | undefined {
  if (!deps.stat(request.sessionFile).isFile()) return "Session path is not a regular file.";
  if (!deps.stat(request.cwd).isDirectory()) return "Working directory is not a directory.";
  if (!deps.stat(context.entrypoint).isFile()) return "Pi entrypoint is no longer available.";
  const header = deps.readHeader(request.sessionFile);
  if (header.id !== request.sessionId) return "Session ID does not match the session file.";
  if (header.cwd !== request.cwd) return "Session working directory does not match the request.";
  return undefined;
}

function validateRequest(
  request: RestartRequest,
  context: GenerationContext,
  deps: LauncherDependencies,
): string | undefined {
  const shapeError = requestShapeError(request, context);
  if (shapeError) return shapeError;
  try {
    return requestResourceError(request, context, deps);
  } catch (error) {
    return error instanceof Error ? error.message : "Restart preflight failed.";
  }
}

function readyMatches(message: RuntimeReady, expected: RestartRequest | undefined): boolean {
  return (
    message.sessionFile === expected?.sessionFile &&
    message.sessionId === expected.sessionId &&
    message.cwd === expected.cwd
  );
}

async function runGeneration(
  worker: PiWorker,
  context: GenerationContext,
  deps: LauncherDependencies,
): Promise<GenerationResult> {
  let accepted: RestartRequest | undefined;
  let ready = false;
  worker.onMessage((message) => {
    const parsed = parseLauncherInboundMessage(message);
    if (parsed?.generation !== context.generation) return;
    if (parsed.type === "runtimeReady") {
      ready = readyMatches(parsed, context.expected);
      return;
    }
    if (accepted) {
      worker.send(restartRejected(parsed, "A restart request is already pending."));
      return;
    }
    const rejection = validateRequest(parsed, context, deps);
    if (rejection) {
      worker.send(restartRejected(parsed, rejection));
      return;
    }
    worker.send(restartAccepted(parsed));
    accepted = parsed;
  });
  const exit = await worker.wait();
  return { exit, ...(accepted ? { accepted } : {}), ready };
}

function workerEnvironment(
  deps: LauncherDependencies,
  generation: string,
  expected: RestartRequest | undefined,
): NodeJS.ProcessEnv {
  return {
    ...deps.env,
    [RESTART_PROTOCOL_ENV]: RESTART_PROTOCOL_SCHEMA,
    [RESTART_GENERATION_ENV]: generation,
    ...(expected
      ? {
          [EXPECTED_SESSION_FILE_ENV]: expected.sessionFile,
          [EXPECTED_SESSION_ID_ENV]: expected.sessionId,
          [EXPECTED_CWD_ENV]: expected.cwd,
        }
      : {}),
  };
}

function failedExit(exit: WorkerExit): string | undefined {
  if (exit.error) return exit.error.message;
  if (exit.signal) return `Pi exited from signal ${exit.signal}.`;
  if (exit.code !== 0) return `Pi exited with code ${String(exit.code)}.`;
  return undefined;
}

type LauncherState = {
  generation: string;
  args: string[];
  expected?: RestartRequest;
};

type WorkerStart = { worker: PiWorker } | { error: string };

function startGeneration(
  state: LauncherState,
  entrypoint: string,
  deps: LauncherDependencies,
): WorkerStart {
  try {
    return {
      worker: deps.startWorker({
        entrypoint,
        args: state.args,
        cwd: deps.cwd,
        env: workerEnvironment(deps, state.generation, state.expected),
      }),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to start Pi." };
  }
}

function reportStartFailure(
  start: Extract<WorkerStart, { error: string }>,
  state: LauncherState,
  deps: LauncherDependencies,
): number {
  const message = state.expected
    ? recoveryMessage(state.expected.sessionFile, start.error)
    : start.error;
  deps.writeError(message);
  return 1;
}

function ordinaryExitCode(exit: WorkerExit): number {
  if (exit.signal || exit.error) return 1;
  return exit.code ?? 0;
}

function nextState(
  request: RestartRequest,
  policy: RestartArgumentPolicy,
  deps: LauncherDependencies,
): LauncherState {
  return {
    generation: deps.createGeneration(),
    args: replacementArguments(policy, request.sessionFile),
    expected: request,
  };
}

type GenerationDecision = { restart: RestartRequest } | { exitCode: number };

function generationDecision(
  result: GenerationResult,
  deps: LauncherDependencies,
): GenerationDecision {
  if (!result.accepted || deps.shouldStop()) return { exitCode: ordinaryExitCode(result.exit) };
  const failure = failedExit(result.exit);
  if (!failure) return { restart: result.accepted };
  deps.writeError(recoveryMessage(result.accepted.sessionFile, failure));
  return { exitCode: result.exit.code ?? 1 };
}

export async function runLauncher(
  initialArgs: readonly string[],
  overrides: Partial<LauncherDependencies> = {},
): Promise<number> {
  const deps = { ...defaultDependencies(), ...overrides };
  const entrypoint = deps.resolveEntrypoint();
  const policy = analyzeRestartArguments(initialArgs);
  let state: LauncherState = { generation: deps.createGeneration(), args: [...initialArgs] };

  while (!deps.shouldStop()) {
    const started = startGeneration(state, entrypoint, deps);
    if ("error" in started) return reportStartFailure(started, state, deps);
    deps.onWorker(started.worker);
    const result = await runGeneration(
      started.worker,
      {
        generation: state.generation,
        entrypoint,
        policy,
        launchCwd: deps.cwd,
        ...(state.expected ? { expected: state.expected } : {}),
      },
      deps,
    );
    deps.onWorker(undefined);
    const decision = generationDecision(result, deps);
    if ("exitCode" in decision) return decision.exitCode;
    state = nextState(decision.restart, policy, deps);
  }
  return 0;
}

export async function main(args: readonly string[]): Promise<number> {
  let currentWorker: PiWorker | undefined;
  let stopping = false;
  const stop = (signal: NodeJS.Signals): void => {
    stopping = true;
    currentWorker?.kill(signal);
  };
  const onInterrupt = (): void => {
    // The foreground Pi child receives terminal SIGINT directly.
  };
  const onTerminate = (): void => {
    stop("SIGTERM");
  };
  const onHangup = (): void => {
    stop("SIGHUP");
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  process.on("SIGHUP", onHangup);
  try {
    return await runLauncher(args, {
      onWorker: (worker) => {
        currentWorker = worker;
      },
      shouldStop: () => stopping,
    });
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    process.off("SIGHUP", onHangup);
  }
}
