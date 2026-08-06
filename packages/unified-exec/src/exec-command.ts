import {
  type CollectedOutput,
  collectedOutputFromBytes,
  collectOutputUntilDeadline,
} from "./collect.ts";
import {
  commandEnvironmentEvent,
  throwIfCommandEnvironmentRejected,
  type CommandEnvironmentModel,
} from "./command-environment.ts";
import {
  DEFAULT_EXEC_YIELD_MS,
  EARLY_EXIT_GRACE_PERIOD_MS,
  MAX_PTY_COLS,
  MAX_PTY_ROWS,
  MIN_PTY_COLS,
  MIN_PTY_ROWS,
  WARNING_SESSIONS,
} from "./constants.ts";
import { sleep } from "./notify.ts";
import { getPtyLoadError, isPtyAvailable } from "./pty.ts";
import { envelopeFromCollected } from "./response.ts";
import { watchSessionExit, removeSession, unwatchSessionExit } from "./session-ui.ts";
import { ExecSession } from "./session.ts";
import {
  buildShellCommand,
  IS_WINDOWS,
  resolveDefaultShell,
  resolveWindowsShell,
} from "./shell.ts";
import { startStreaming } from "./streaming.ts";
import { nowUtcIso } from "./time.ts";
import { clampYield } from "./tool-helpers.ts";
import { finalizeProcessResult } from "./tool-result.ts";
import type { ExecCommandArgs } from "./tool-schema.ts";
import type { ProcessResultDetails } from "./tool-result.ts";
import type { ExtensionRuntime, ToolUpdate } from "./tool-types.ts";

type PreparedCommand = Readonly<{
  command: string[];
  cwd: string;
  shell: string;
  tty: boolean;
  cols: number | undefined;
  rows: number | undefined;
  yieldTimeMs: number;
  windowsVerbatimArguments: boolean | undefined;
}>;

type RunningCommand = PreparedCommand & Readonly<{ session: ExecSession; startedAt: number }>;

// eslint-disable-next-line complexity -- Keep platform shell selection and one-time notices together.
function resolveShell(runtime: ExtensionRuntime, requested: string | undefined): string {
  if (requested && IS_WINDOWS) return resolveWindowsShell(requested);
  if (requested) return requested;
  const resolved = resolveDefaultShell();
  if (resolved.fellBack && !runtime.warnedShellFallback) {
    runtime.warnedShellFallback = true;
    runtime.ui?.notify("unified-exec: bash unavailable; using PowerShell", "warning");
  } else if (
    resolved.bashSource &&
    resolved.bashSource !== "path" &&
    resolved.bashSource !== "env" &&
    !runtime.notifiedBashSource
  ) {
    runtime.notifiedBashSource = true;
    runtime.ui?.notify(`unified-exec: using bash at ${resolved.shell} (not on PATH)`, "info");
  }
  return resolved.shell;
}

// eslint-disable-next-line complexity -- Keep shell, PTY geometry, and yield clamping in one preparation pass.
function prepareCommand(
  runtime: ExtensionRuntime,
  args: ExecCommandArgs,
  cwd: string,
): PreparedCommand {
  const tty = args.tty ?? false;
  if (tty && !isPtyAvailable()) {
    throw new Error(
      `tty: true requires @homebridge/node-pty-prebuilt-multiarch: ${getPtyLoadError() ?? "unknown load error"}. Use tty: false for pipes.`,
    );
  }
  const shell = resolveShell(runtime, args.shell);
  const shellCommand = buildShellCommand(shell, args.cmd);
  return {
    command: shellCommand.command,
    cwd: args.workdir?.length ? args.workdir : cwd,
    shell,
    tty,
    cols:
      args.cols !== undefined
        ? Math.min(MAX_PTY_COLS, Math.max(MIN_PTY_COLS, Math.floor(args.cols)))
        : undefined,
    rows:
      args.rows !== undefined
        ? Math.min(MAX_PTY_ROWS, Math.max(MIN_PTY_ROWS, Math.floor(args.rows)))
        : undefined,
    yieldTimeMs: clampYield(args.yield_time_ms, DEFAULT_EXEC_YIELD_MS),
    windowsVerbatimArguments: shellCommand.windowsVerbatimArguments,
  };
}

function spawn(
  runtime: ExtensionRuntime,
  args: ExecCommandArgs,
  prepared: PreparedCommand,
  model: CommandEnvironmentModel | undefined,
): ExecSession {
  const environmentEvent = commandEnvironmentEvent(args.cmd, prepared.cwd, prepared.shell, model);
  runtime.prepareEnvironment(environmentEvent);
  throwIfCommandEnvironmentRejected(environmentEvent);
  const id = runtime.store.allocateId();
  const session = ExecSession.spawn(id, {
    command: prepared.command,
    cwd: prepared.cwd,
    env: environmentEvent.environment,
    tty: prepared.tty,
    cols: prepared.cols,
    rows: prepared.rows,
    displayCommand: args.cmd,
    shell: prepared.shell,
    windowsVerbatimArguments: prepared.windowsVerbatimArguments,
  });
  return session;
}

async function waitEarlyGrace(
  session: ExecSession,
  signal: AbortSignal | undefined,
): Promise<void> {
  await Promise.race([
    new Promise<void>((resolve) => {
      if (session.hasExited) resolve();
      else session.exited.addEventListener("abort", () => resolve(), { once: true });
    }),
    sleep(EARLY_EXIT_GRACE_PERIOD_MS, signal),
  ]);
}

// Exit delivered in this very result: a requested wake is satisfied directly
// without ever being armed, and the delivery is auditable from the transcript.
function directDeliveryExtra(args: ExecCommandArgs): {
  on_exit: ExecCommandArgs["on_exit"];
  completion_delivery?: "direct";
  tool_time_utc?: string;
} {
  const wantsWake = args.on_exit === "wake";
  return {
    on_exit: args.on_exit,
    ...(wantsWake ? { completion_delivery: "direct" as const, tool_time_utc: nowUtcIso() } : {}),
  };
}

async function finalizeExited(
  command: RunningCommand,
  args: ExecCommandArgs,
  signal: AbortSignal | undefined,
): Promise<ProcessResultDetails> {
  const collected = await collectOutputUntilDeadline({
    buffer: command.session.outputBuffer,
    outputNotify: command.session.outputNotify,
    outputClosed: command.session.outputClosed,
    exited: command.session.exited,
    // macOS can deliver stdout/stderr shortly after the exit event for very
    // fast commands. Give the trailing drain a bounded but less brittle window.
    deadlineMs: Date.now() + 500,
    externalAbort: signal,
  });
  return finalizeProcessResult({
    operation: "exec_command",
    wallTimeSec: (Date.now() - command.startedAt) / 1000,
    ...envelopeFromCollected(collected),
    totalBytes: command.session.totalBytesSeen,
    sessionId: undefined,
    exitCode: command.session.exitCode,
    signal: command.session.signal,
    failure: command.session.failureMessage,
    tty: command.tty,
    logPath: command.session.logPath,
    cwd: command.cwd,
    command: args.cmd,
    yieldTimeMs: command.yieldTimeMs,
    extra: directDeliveryExtra(args),
  });
}

function insertSession(runtime: ExtensionRuntime, session: ExecSession): void {
  const { pruned, count } = runtime.store.insert(session);
  watchSessionExit(runtime, session);
  if (pruned) {
    unwatchSessionExit(runtime, pruned.id);
    runtime.coordinator.handleEviction(pruned);
    runtime.ui?.notify(
      `unified-exec: evicted session ${String(pruned.id)} at the session cap`,
      "warning",
    );
  }
  if (count >= WARNING_SESSIONS) {
    runtime.ui?.notify(
      `unified-exec: ${String(count)}/${String(runtime.store.maxSessions)} sessions open`,
      "warning",
    );
  }
}

async function collectInitialWindow(
  command: RunningCommand,
  signal: AbortSignal | undefined,
  onUpdate: ToolUpdate | undefined,
): Promise<CollectedOutput> {
  const deadlineMs = command.startedAt + command.yieldTimeMs;
  const stream = startStreaming(command.session, onUpdate, deadlineMs, signal);
  const collected = await collectOutputUntilDeadline({
    buffer: command.session.outputBuffer,
    outputNotify: command.session.outputNotify,
    outputClosed: command.session.outputClosed,
    exited: command.session.exited,
    deadlineMs,
    externalAbort: signal,
  });
  stream.stop();
  command.session.touch();
  return collected;
}

function finalizeRunning(
  runtime: ExtensionRuntime,
  command: RunningCommand,
  args: ExecCommandArgs,
  collected: CollectedOutput,
): ProcessResultDetails {
  const wantsWake = args.on_exit === "wake";
  if (wantsWake) runtime.coordinator.register(command.session);
  return finalizeProcessResult({
    operation: "exec_command",
    wallTimeSec: (Date.now() - command.startedAt) / 1000,
    ...envelopeFromCollected(collected),
    totalBytes: command.session.totalBytesSeen,
    sessionId: command.session.id,
    exitCode: undefined,
    signal: null,
    failure: null,
    tty: command.tty,
    logPath: command.session.logPath,
    cwd: command.cwd,
    command: args.cmd,
    yieldTimeMs: command.yieldTimeMs,
    extra: {
      on_exit: args.on_exit,
      ...(wantsWake ? { completion_notification: "armed" as const } : {}),
      tool_time_utc: nowUtcIso(),
    },
  });
}

async function runSpawned(
  runtime: ExtensionRuntime,
  command: RunningCommand,
  args: ExecCommandArgs,
  signal: AbortSignal | undefined,
  onUpdate: ToolUpdate | undefined,
): Promise<ProcessResultDetails> {
  const earlyDeadline = command.startedAt + EARLY_EXIT_GRACE_PERIOD_MS + 20;
  await waitEarlyGrace(command.session, signal);
  if (command.session.hasExited && Date.now() <= earlyDeadline)
    return finalizeExited(command, args, signal);
  insertSession(runtime, command.session);
  const collected = await collectInitialWindow(command, signal, onUpdate);
  if (!command.session.hasExited) return finalizeRunning(runtime, command, args, collected);
  // Process exited during this call → respond with exit info, not a
  // session_id. The wake is never armed: the exit was delivered directly.
  removeSession(runtime, command.session.id);
  return finalizeProcessResult({
    operation: "exec_command",
    wallTimeSec: (Date.now() - command.startedAt) / 1000,
    ...envelopeFromCollected(collected),
    totalBytes: command.session.totalBytesSeen,
    sessionId: undefined,
    exitCode: command.session.exitCode,
    signal: command.session.signal,
    failure: command.session.failureMessage,
    tty: command.tty,
    logPath: command.session.logPath,
    cwd: command.cwd,
    command: args.cmd,
    yieldTimeMs: command.yieldTimeMs,
    extra: directDeliveryExtra(args),
  });
}

export async function runExecCommand(
  runtime: ExtensionRuntime,
  args: ExecCommandArgs,
  signal: AbortSignal | undefined,
  onUpdate: ToolUpdate | undefined,
  cwd: string,
  model?: CommandEnvironmentModel,
): Promise<ProcessResultDetails> {
  if (runtime.shuttingDown) throw new Error("unified-exec: session is shutting down");
  const prepared = prepareCommand(runtime, args, cwd);
  const session = spawn(runtime, args, prepared, model);
  if (session.failureMessage) {
    return finalizeProcessResult({
      operation: "exec_command",
      wallTimeSec: 0,
      ...envelopeFromCollected(collectedOutputFromBytes(new Uint8Array())),
      sessionId: undefined,
      exitCode: -1,
      signal: null,
      failure: session.failureMessage,
      tty: prepared.tty,
      cwd: prepared.cwd,
      command: args.cmd,
      yieldTimeMs: prepared.yieldTimeMs,
    });
  }
  runtime.pendingSessions.add(session);
  try {
    return await runSpawned(
      runtime,
      { ...prepared, session, startedAt: Date.now() },
      args,
      signal,
      onUpdate,
    );
  } finally {
    runtime.pendingSessions.delete(session);
  }
}
