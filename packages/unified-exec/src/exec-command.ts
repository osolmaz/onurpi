import {
  type CollectedOutput,
  collectedOutputFromBytes,
  collectOutputUntilDeadline,
} from "./collect.ts";
import {
  DEFAULT_EXEC_YIELD_MS,
  EARLY_EXIT_GRACE_PERIOD_MS,
  WARNING_SESSIONS,
} from "./constants.ts";
import { sleep } from "./notify.ts";
import { getPtyLoadError, isPtyAvailable } from "./pty.ts";
import { finalizeResponse } from "./response.ts";
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
import type { ExecCommandArgs } from "./tool-schema.ts";
import type { ExtensionRuntime, FinalResponseDetails, ToolUpdate } from "./tool-types.ts";

type PreparedCommand = Readonly<{
  command: string[];
  cwd: string;
  shell: string;
  tty: boolean;
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
    yieldTimeMs: clampYield(args.yield_time_ms, DEFAULT_EXEC_YIELD_MS),
    windowsVerbatimArguments: shellCommand.windowsVerbatimArguments,
  };
}

function spawn(
  runtime: ExtensionRuntime,
  args: ExecCommandArgs,
  prepared: PreparedCommand,
): ExecSession {
  const id = runtime.store.allocateId();
  const session = ExecSession.spawn(id, {
    command: prepared.command,
    cwd: prepared.cwd,
    env: process.env,
    tty: prepared.tty,
    displayCommand: args.cmd,
    shell: prepared.shell,
    windowsVerbatimArguments: prepared.windowsVerbatimArguments,
  });
  if (session.failureMessage) runtime.store.releaseId(id);
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

async function finalizeExited(
  command: RunningCommand,
  args: ExecCommandArgs,
): Promise<FinalResponseDetails> {
  const collected = await collectOutputUntilDeadline({
    buffer: command.session.outputBuffer,
    outputNotify: command.session.outputNotify,
    outputClosed: command.session.outputClosed,
    exited: command.session.exited,
    deadlineMs: Date.now() + 500,
  });
  return finalizeResponse({
    wallTimeSec: (Date.now() - command.startedAt) / 1000,
    collected,
    exitCode: command.session.exitCode,
    signal: command.session.signal,
    failure: command.session.failureMessage,
    tty: command.tty,
    logPath: command.session.logPath,
    cwd: command.cwd,
    command: args.cmd,
    yieldTimeMs: command.yieldTimeMs,
    extra: { on_exit: args.on_exit },
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
): FinalResponseDetails {
  const wantsWake = args.on_exit === "wake";
  if (wantsWake) runtime.coordinator.register(command.session);
  return finalizeResponse({
    wallTimeSec: (Date.now() - command.startedAt) / 1000,
    collected,
    sessionId: command.session.id,
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
): Promise<FinalResponseDetails> {
  const earlyDeadline = command.startedAt + EARLY_EXIT_GRACE_PERIOD_MS + 20;
  await waitEarlyGrace(command.session, signal);
  if (command.session.hasExited && Date.now() <= earlyDeadline)
    return finalizeExited(command, args);
  insertSession(runtime, command.session);
  const collected = await collectInitialWindow(command, signal, onUpdate);
  if (!command.session.hasExited) return finalizeRunning(runtime, command, args, collected);
  removeSession(runtime, command.session.id);
  return finalizeResponse({
    wallTimeSec: (Date.now() - command.startedAt) / 1000,
    collected,
    exitCode: command.session.exitCode,
    signal: command.session.signal,
    failure: command.session.failureMessage,
    tty: command.tty,
    logPath: command.session.logPath,
    cwd: command.cwd,
    command: args.cmd,
    yieldTimeMs: command.yieldTimeMs,
    extra: { on_exit: args.on_exit },
  });
}

export async function runExecCommand(
  runtime: ExtensionRuntime,
  args: ExecCommandArgs,
  signal: AbortSignal | undefined,
  onUpdate: ToolUpdate | undefined,
  cwd: string,
): Promise<FinalResponseDetails> {
  if (runtime.shuttingDown) throw new Error("unified-exec: session is shutting down");
  const prepared = prepareCommand(runtime, args, cwd);
  const session = spawn(runtime, args, prepared);
  if (session.failureMessage) {
    return finalizeResponse({
      wallTimeSec: 0,
      collected: collectedOutputFromBytes(new Uint8Array()),
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
