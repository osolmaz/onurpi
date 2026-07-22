import {
  type CollectedOutput,
  collectedOutputFromBytes,
  collectOutputUntilDeadline,
} from "./collect.ts";
import { DEFAULT_WRITE_STDIN_YIELD_MS, LONG_WAIT_UPDATE_INTERVAL_MS } from "./constants.ts";
import {
  type LongWaitOutcome,
  startRateLimitedStream,
  waitForExitOrDeadline,
} from "./long-wait.ts";
import { sleep } from "./notify.ts";
import { decode, finalizeResponse } from "./response.ts";
import { removeSession } from "./session-ui.ts";
import type { ExecSession } from "./session.ts";
import { startStreaming } from "./streaming.ts";
import { nowUtcIso, parseYieldUntil } from "./time.ts";
import { clampYield, resolveEmptyPollYield, resolveWriteInput } from "./tool-helpers.ts";
import type { WriteStdinArgs } from "./tool-schema.ts";
import type {
  ExtensionRuntime,
  FinalResponseDetails,
  ToolUpdate,
  UnifiedExecDetails,
  WaitMode,
} from "./tool-types.ts";

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
): FinalResponseDetails {
  const armed = runtime.coordinator.isArmed(session.id);
  removeSession(runtime, session.id);
  runtime.coordinator.markPendingTerminal(session.id, toolCallId);
  return finalizeResponse({
    wallTimeSec: (Date.now() - startedAt) / 1000,
    collected,
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

async function runRelativeWait(
  runtime: ExtensionRuntime,
  session: ExecSession,
  args: WriteStdinArgs,
  bytes: Uint8Array | undefined,
  signal: AbortSignal | undefined,
  onUpdate: ToolUpdate | undefined,
  toolCallId: string,
): Promise<FinalResponseDetails> {
  const isEmptyPoll = !bytes?.length;
  const yieldTimeMs = isEmptyPoll
    ? resolveEmptyPollYield(args.yield_time_ms)
    : clampYield(args.yield_time_ms, DEFAULT_WRITE_STDIN_YIELD_MS);
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
        waitMode: isEmptyPoll ? "relative" : undefined,
        writeFailure,
        yieldTimeMs,
      });
    }
    return finalizeRelativeRunning(runtime, session, toolCallId, startedAt, collected, {
      isEmptyPoll,
      signal,
      writeFailure,
      yieldTimeMs,
    });
  } catch (error: unknown) {
    runtime.coordinator.releaseObservation(session.id, toolCallId);
    throw error;
  }
}

function finalizeRelativeRunning(
  runtime: ExtensionRuntime,
  session: ExecSession,
  toolCallId: string,
  startedAt: number,
  collected: CollectedOutput,
  options: Readonly<{
    isEmptyPoll: boolean;
    signal: AbortSignal | undefined;
    writeFailure: string | undefined;
    yieldTimeMs: number;
  }>,
): FinalResponseDetails {
  const armed = runtime.coordinator.isArmed(session.id);
  runtime.coordinator.releaseObservation(session.id, toolCallId);
  return finalizeResponse({
    wallTimeSec: (Date.now() - startedAt) / 1000,
    collected,
    sessionId: session.id,
    signal: null,
    failure: options.writeFailure ?? null,
    tty: session.tty,
    logPath: session.logPath,
    cwd: session.cwd,
    command: session.displayCommand,
    yieldTimeMs: options.yieldTimeMs,
    extra: {
      ...(options.isEmptyPoll
        ? {
            wait_mode: "relative" as const,
            wait_status: options.signal?.aborted
              ? ("cancelled" as const)
              : ("relative_deadline_reached" as const),
          }
        : {}),
      tool_time_utc: nowUtcIso(),
      ...(armed ? { on_exit: "wake" as const, completion_notification: "armed" as const } : {}),
    },
  });
}

function absoluteUpdate(session: ExecSession, yieldUntil: string): UnifiedExecDetails {
  const output = decode(session.snapshotStreamTail());
  return {
    session_id: session.id,
    pid: session.pid,
    total_bytes: session.totalBytesSeen,
    running: !session.hasExited,
    tty: session.tty,
    command: session.displayCommand,
    cwd: session.cwd,
    log_path: session.logPath,
    yield_until: yieldUntil,
    output,
  };
}

function startAbsoluteStream(
  session: ExecSession,
  yieldUntil: string,
  onUpdate: ToolUpdate | undefined,
): { stop: () => void } | undefined {
  if (!onUpdate) return undefined;
  return startRateLimitedStream({
    outputNotify: session.outputNotify,
    minIntervalMs: LONG_WAIT_UPDATE_INTERVAL_MS,
    emit: () => {
      const details = absoluteUpdate(session, yieldUntil);
      onUpdate({ content: [{ type: "text", text: details.output ?? "" }], details });
    },
  });
}

async function waitAbsolute(
  runtime: ExtensionRuntime,
  session: ExecSession,
  durationMs: number,
  signal: AbortSignal | undefined,
  toolCallId: string,
): Promise<LongWaitOutcome> {
  try {
    return await waitForExitOrDeadline({
      exited: session.exited,
      externalAbort: signal,
      durationMs,
    });
  } catch (error: unknown) {
    runtime.coordinator.releaseObservation(session.id, toolCallId);
    throw error;
  }
}

async function finalizeAbsoluteNonExit(
  runtime: ExtensionRuntime,
  session: ExecSession,
  toolCallId: string,
  startedAt: number,
  yieldUntil: string,
  outcome: Exclude<LongWaitOutcome, "exit">,
  signal: AbortSignal | undefined,
): Promise<FinalResponseDetails> {
  const armed = runtime.coordinator.isArmed(session.id);
  runtime.coordinator.releaseObservation(session.id, toolCallId);
  const cancelled = outcome === "cancelled";
  const collected = cancelled
    ? collectedOutputFromBytes(new Uint8Array())
    : await collectOutputUntilDeadline({
        buffer: session.outputBuffer,
        outputNotify: session.outputNotify,
        outputClosed: session.outputClosed,
        exited: session.exited,
        deadlineMs: Date.now(),
        externalAbort: signal,
      });
  return finalizeResponse({
    wallTimeSec: (Date.now() - startedAt) / 1000,
    collected,
    sessionId: session.id,
    signal: null,
    failure: null,
    tty: session.tty,
    logPath: session.logPath,
    cwd: session.cwd,
    command: session.displayCommand,
    extra: {
      wait_mode: "absolute",
      wait_status: cancelled ? "cancelled" : "absolute_deadline_reached",
      yield_until: yieldUntil,
      ...(!cancelled ? { effective_wait_ms: Date.now() - startedAt } : {}),
      tool_time_utc: nowUtcIso(),
      ...(armed ? { on_exit: "wake", completion_notification: "armed" } : {}),
    },
  });
}

async function runAbsoluteWait(
  runtime: ExtensionRuntime,
  session: ExecSession,
  yieldUntilRaw: string,
  signal: AbortSignal | undefined,
  onUpdate: ToolUpdate | undefined,
  toolCallId: string,
): Promise<FinalResponseDetails> {
  const startedAt = Date.now();
  const parsed = parseYieldUntil(yieldUntilRaw, startedAt);
  session.touch();
  runtime.coordinator.beginObservation(session.id, toolCallId);
  const stream = startAbsoluteStream(session, parsed.normalized, onUpdate);
  let outcome = await waitAbsolute(runtime, session, parsed.remainingMs, signal, toolCallId);
  stream?.stop();
  if (session.hasExited) outcome = "exit";
  if (outcome === "exit") {
    const collected = await collectTerminalOutput(session);
    return finalizeTerminal(runtime, session, toolCallId, startedAt, collected, {
      waitMode: "absolute",
      yieldUntil: parsed.normalized,
    });
  }
  return finalizeAbsoluteNonExit(
    runtime,
    session,
    toolCallId,
    startedAt,
    parsed.normalized,
    outcome,
    signal,
  );
}

export async function runWriteStdin(
  runtime: ExtensionRuntime,
  args: WriteStdinArgs,
  signal: AbortSignal | undefined,
  onUpdate: ToolUpdate | undefined,
  toolCallId: string,
): Promise<FinalResponseDetails> {
  const session = runtime.store.get(args.session_id);
  if (!session) throw new Error(`unknown session_id: ${String(args.session_id)}`);
  const bytes = resolveWriteInput(args);
  const isEmptyPoll = !bytes?.length;
  validateWaitArguments(args, isEmptyPoll);
  if (args.yield_until) {
    return runAbsoluteWait(runtime, session, args.yield_until, signal, onUpdate, toolCallId);
  }
  return runRelativeWait(runtime, session, args, bytes, signal, onUpdate, toolCallId);
}
