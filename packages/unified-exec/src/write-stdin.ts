import { type CollectedOutput, collectOutputUntilDeadline } from "./collect.ts";
import { commandInputEvent, throwIfCommandInputRejected } from "./command-input.ts";
import { runFinalInputPolicies } from "./command-policy.ts";
import {
  DEFAULT_WRITE_STDIN_YIELD_MS,
  LONG_WAIT_UPDATE_INTERVAL_MS,
  MAX_YIELD_TIME_MS,
  OUTPUT_POLL_INTERVAL_MS,
} from "./constants.ts";
import {
  type LongWaitOutcome,
  startRateLimitedStream,
  waitForExitOrDeadline,
} from "./long-wait.ts";
import { sleep } from "./notify.ts";
import { sanitizeOutputText } from "./output-safety.ts";
import { decode, envelopeFromCollected } from "./response.ts";
import { removeSession } from "./session-ui.ts";
import type { ExecSession } from "./session.ts";
import { startStreaming } from "./streaming.ts";
import { nowUtcIso, parseYieldUntil } from "./time.ts";
import { clampYield, resolveEmptyPollYield, resolveWriteInput } from "./tool-helpers.ts";
import { finalizeProcessResult } from "./tool-result.ts";
import type { WriteStdinArgs } from "./tool-schema.ts";
import type { ProcessResultDetails, ProcessResultExtra } from "./tool-result.ts";
import type { ExtensionRuntime, ToolUpdate, UnifiedExecDetails, WaitMode } from "./tool-types.ts";

function validateWaitArguments(args: WriteStdinArgs, isEmptyPoll: boolean): void {
  const hasDeadline = typeof args.yield_until === "string" && args.yield_until.length > 0;
  if (hasDeadline && args.yield_time_ms !== undefined) {
    throw new Error(
      `write_stdin: pass either yield_time_ms or yield_until, not both. tool_time_utc: ${nowUtcIso()}`,
    );
  }
  if (hasDeadline && !isEmptyPoll) {
    throw new Error(
      `write_stdin: yield_until is only valid for an empty poll. tool_time_utc: ${nowUtcIso()}`,
    );
  }
}

function terminalExtra(waitMode: WaitMode | undefined, wakeWasArmed: boolean): UnifiedExecDetails {
  return {
    wait_mode: waitMode,
    wait_status: waitMode ? "completed" : undefined,
    completion_delivery: "direct",
    tool_time_utc: nowUtcIso(),
    ...(wakeWasArmed ? { on_exit: "wake", on_exit_wake: "consumed" } : {}),
  };
}

async function collectTerminalOutput(
  session: ExecSession,
  deadlineMs = Date.now() + 1000,
): Promise<CollectedOutput> {
  return collectOutputUntilDeadline({
    buffer: session.outputBuffer,
    outputNotify: session.outputNotify,
    outputClosed: session.outputClosed,
    exited: session.exited,
    deadlineMs,
  });
}

function finalizeTerminal(
  runtime: ExtensionRuntime,
  session: ExecSession,
  toolCallId: string,
  startedAt: number,
  collected: CollectedOutput,
  options: Readonly<{
    waitMode?: WaitMode | undefined;
    writeFailure?: string | undefined;
    yieldTimeMs?: number | undefined;
    yieldUntil?: string | undefined;
  }>,
): ProcessResultDetails {
  const armed = runtime.coordinator.isArmed(session.id);
  removeSession(runtime, session.id);
  runtime.coordinator.markPendingTerminal(session.id, toolCallId);
  return finalizeProcessResult({
    operation: "write_stdin",
    wallTimeSec: (Date.now() - startedAt) / 1000,
    ...envelopeFromCollected(collected),
    totalBytes: session.totalBytesSeen,
    sessionId: undefined,
    exitCode: session.exitCode,
    signal: session.signal,
    failure: session.failureMessage ?? options.writeFailure ?? null,
    tty: session.tty,
    logPath: session.logPath,
    cwd: session.cwd,
    command: session.displayCommand,
    yieldTimeMs: options.yieldTimeMs,
    extra: { ...terminalExtra(options.waitMode, armed), yield_until: options.yieldUntil },
  });
}

async function writeInput(
  session: ExecSession,
  bytes: Uint8Array | undefined,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (!bytes?.length) return undefined;
  const accepted = session.write(bytes);
  if (!accepted && !session.hasExited) {
    return "stdin write failed: the child closed its stdin; bytes were not delivered";
  }
  if (accepted) await sleep(100, signal);
  return undefined;
}

async function runInputWait(
  runtime: ExtensionRuntime,
  session: ExecSession,
  args: WriteStdinArgs,
  bytes: Uint8Array | undefined,
  signal: AbortSignal | undefined,
  onUpdate: ToolUpdate | undefined,
  toolCallId: string,
): Promise<ProcessResultDetails> {
  const yieldTimeMs = clampYield(args.yield_time_ms, DEFAULT_WRITE_STDIN_YIELD_MS);
  const startedAt = Date.now();
  session.touch();
  runtime.coordinator.beginObservation(session.id, toolCallId);
  try {
    const writeFailure = await writeInput(session, bytes, signal);
    if (session.hasExited) {
      const collected = await collectTerminalOutput(session, Date.now() + 50);
      return finalizeTerminal(runtime, session, toolCallId, startedAt, collected, {
        writeFailure,
        yieldTimeMs,
      });
    }
    const deadlineMs = startedAt + yieldTimeMs;
    const stream = startStreaming(session, onUpdate, deadlineMs, signal);
    const collected = await collectOutputUntilDeadline({
      buffer: session.outputBuffer,
      outputNotify: session.outputNotify,
      outputClosed: session.outputClosed,
      exited: session.exited,
      deadlineMs,
      externalAbort: signal,
    });
    stream.stop();
    if (session.hasExited) {
      return finalizeTerminal(runtime, session, toolCallId, startedAt, collected, {
        writeFailure,
        yieldTimeMs,
      });
    }
    return finalizeInputRunning(runtime, session, toolCallId, startedAt, collected, {
      writeFailure,
      yieldTimeMs,
    });
  } catch (error: unknown) {
    runtime.coordinator.releaseObservation(session.id, toolCallId);
    throw error;
  }
}

function finalizeInputRunning(
  runtime: ExtensionRuntime,
  session: ExecSession,
  toolCallId: string,
  startedAt: number,
  collected: CollectedOutput,
  options: Readonly<{
    writeFailure: string | undefined;
    yieldTimeMs: number;
  }>,
): ProcessResultDetails {
  const armed = runtime.coordinator.isArmed(session.id);
  runtime.coordinator.releaseObservation(session.id, toolCallId);
  return finalizeProcessResult({
    operation: "write_stdin",
    wallTimeSec: (Date.now() - startedAt) / 1000,
    ...envelopeFromCollected(collected),
    totalBytes: session.totalBytesSeen,
    sessionId: session.id,
    exitCode: undefined,
    signal: null,
    failure: options.writeFailure ?? null,
    tty: session.tty,
    logPath: session.logPath,
    cwd: session.cwd,
    command: session.displayCommand,
    yieldTimeMs: options.yieldTimeMs,
    extra: {
      tool_time_utc: nowUtcIso(),
      note: session.heldOpenNote,
      ...(armed ? { on_exit: "wake" as const, completion_notification: "armed" as const } : {}),
    },
  });
}

type EmptyWait =
  | { mode: "relative"; durationMs: number }
  | { mode: "absolute"; durationMs: number; yieldUntil: string };

function emptyPollUpdate(session: ExecSession, wait: EmptyWait): UnifiedExecDetails {
  return {
    session_id: session.id,
    pid: session.pid,
    total_bytes: session.totalBytesSeen,
    running: !session.hasExited,
    tty: session.tty,
    command: session.displayCommand,
    cwd: session.cwd,
    log_path: session.logPath,
    ...(wait.mode === "absolute"
      ? { yield_until: wait.yieldUntil }
      : { yield_time_ms: wait.durationMs }),
    output: sanitizeOutputText(decode(session.snapshotStreamTail())),
  };
}

function startEmptyPollStream(
  session: ExecSession,
  wait: EmptyWait,
  onUpdate: ToolUpdate | undefined,
): { stop: () => void } | undefined {
  if (!onUpdate) return undefined;
  return startRateLimitedStream({
    outputNotify: session.outputNotify,
    minIntervalMs:
      wait.mode === "relative" && wait.durationMs <= MAX_YIELD_TIME_MS
        ? OUTPUT_POLL_INTERVAL_MS
        : LONG_WAIT_UPDATE_INTERVAL_MS,
    emit: () => {
      const details = emptyPollUpdate(session, wait);
      onUpdate({ content: [{ type: "text", text: details.output ?? "" }], details });
    },
  });
}

function waitResultFields(wait: EmptyWait): {
  yieldTimeMs?: number;
  yieldUntil?: string;
} {
  return wait.mode === "relative"
    ? { yieldTimeMs: wait.durationMs }
    : { yieldUntil: wait.yieldUntil };
}

function attachedResultExtra(
  wait: EmptyWait,
  outcome: Exclude<LongWaitOutcome, "exit">,
  armed: boolean,
  note: string | undefined,
  elapsedMs: number,
): ProcessResultExtra {
  return {
    wait_mode: wait.mode,
    wait_status:
      outcome === "cancelled"
        ? "cancelled"
        : wait.mode === "relative"
          ? "relative_deadline_reached"
          : "absolute_deadline_reached",
    yield_until: wait.mode === "absolute" ? wait.yieldUntil : undefined,
    effective_wait_ms: outcome === "cancelled" ? undefined : elapsedMs,
    tool_time_utc: nowUtcIso(),
    note,
    ...(armed ? { on_exit: "wake", completion_notification: "armed" } : {}),
  };
}

async function finalizeAttachedNonExit(
  runtime: ExtensionRuntime,
  session: ExecSession,
  toolCallId: string,
  startedAt: number,
  wait: EmptyWait,
  outcome: Exclude<LongWaitOutcome, "exit">,
): Promise<ProcessResultDetails> {
  // Pi can discard a cancelled result. Do not drain output on cancellation.
  const collected =
    outcome === "cancelled"
      ? undefined
      : await collectOutputUntilDeadline({
          buffer: session.outputBuffer,
          outputNotify: session.outputNotify,
          outputClosed: session.outputClosed,
          exited: session.exited,
          deadlineMs: Date.now(),
        });
  if (session.hasExited) {
    return finalizeTerminal(
      runtime,
      session,
      toolCallId,
      startedAt,
      collected ?? (await collectTerminalOutput(session)),
      { waitMode: wait.mode, ...waitResultFields(wait) },
    );
  }
  const armed = runtime.coordinator.isArmed(session.id);
  runtime.coordinator.releaseObservation(session.id, toolCallId);
  return finalizeProcessResult({
    operation: "write_stdin",
    wallTimeSec: (Date.now() - startedAt) / 1000,
    ...(collected ? envelopeFromCollected(collected) : { collected: new Uint8Array() }),
    totalBytes: session.totalBytesSeen,
    sessionId: session.id,
    exitCode: undefined,
    signal: null,
    failure: null,
    tty: session.tty,
    logPath: session.logPath,
    cwd: session.cwd,
    command: session.displayCommand,
    yieldTimeMs: wait.mode === "relative" ? wait.durationMs : undefined,
    extra: attachedResultExtra(wait, outcome, armed, session.heldOpenNote, Date.now() - startedAt),
  });
}

/** Empty polls wait without draining output; the session retains a bounded head and tail. */
async function runAttachedWait(
  runtime: ExtensionRuntime,
  session: ExecSession,
  wait: EmptyWait,
  signal: AbortSignal | undefined,
  onUpdate: ToolUpdate | undefined,
  toolCallId: string,
): Promise<ProcessResultDetails> {
  const startedAt = Date.now();
  session.touch();
  runtime.coordinator.beginObservation(session.id, toolCallId);
  const stream = startEmptyPollStream(session, wait, onUpdate);
  try {
    const outcome = await waitForExitOrDeadline({
      exited: session.exited,
      externalAbort: signal,
      durationMs: wait.durationMs,
    });
    if (outcome === "exit" || session.hasExited) {
      const collected = await collectTerminalOutput(session);
      return finalizeTerminal(runtime, session, toolCallId, startedAt, collected, {
        waitMode: wait.mode,
        ...waitResultFields(wait),
      });
    }
    return await finalizeAttachedNonExit(runtime, session, toolCallId, startedAt, wait, outcome);
  } catch (error: unknown) {
    runtime.coordinator.releaseObservation(session.id, toolCallId);
    throw error;
  } finally {
    stream?.stop();
  }
}

export async function runWriteStdin(
  runtime: ExtensionRuntime,
  args: WriteStdinArgs,
  signal: AbortSignal | undefined,
  onUpdate: ToolUpdate | undefined,
  toolCallId: string,
): Promise<ProcessResultDetails> {
  const session = runtime.store.get(args.session_id);
  if (!session) throw new Error(`unknown session_id: ${String(args.session_id)}`);
  const bytes = resolveWriteInput(args);
  const isEmptyPoll = !bytes?.length;
  validateWaitArguments(args, isEmptyPoll);
  if (bytes?.length) {
    const inputEvent = commandInputEvent(
      toolCallId,
      session.id,
      session.displayCommand,
      session.cwd,
      session.shell,
      session.tty,
      bytes,
    );
    runtime.prepareInput(inputEvent);
    throwIfCommandInputRejected(inputEvent);
    const finalInputEvent = commandInputEvent(
      toolCallId,
      session.id,
      session.displayCommand,
      session.cwd,
      session.shell,
      session.tty,
      bytes,
    );
    runFinalInputPolicies(finalInputEvent);
    throwIfCommandInputRejected(finalInputEvent);
  }
  if (isEmptyPoll) {
    const parsed = args.yield_until ? parseYieldUntil(args.yield_until, Date.now()) : undefined;
    const wait: EmptyWait = parsed
      ? { mode: "absolute", durationMs: parsed.remainingMs, yieldUntil: parsed.normalized }
      : { mode: "relative", durationMs: resolveEmptyPollYield(args.yield_time_ms) };
    return runAttachedWait(runtime, session, wait, signal, onUpdate, toolCallId);
  }
  return runInputWait(runtime, session, args, bytes, signal, onUpdate, toolCallId);
}
