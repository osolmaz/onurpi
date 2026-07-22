import { collectOutputUntilDeadline } from "./collect.ts";
import { sleep } from "./notify.ts";
import { finalizeResponse, renderResponseOutput } from "./response.ts";
import { removeSession } from "./session-ui.ts";
import type { ExecSession } from "./session.ts";
import { IS_WINDOWS } from "./shell.ts";
import type { ExtensionRuntime } from "./tool-types.ts";

export type TerminateOutcome = Readonly<{
  session: ExecSession;
  escalated: boolean;
  finalOutput: string;
  killed: boolean;
}>;

async function waitForExit(
  session: ExecSession,
  durationMs: number,
  intervalMs: number,
): Promise<void> {
  const deadline = Date.now() + durationMs;
  while (!session.hasExited && Date.now() < deadline) await sleep(intervalMs);
}

async function drain(session: ExecSession): Promise<string> {
  const collected = await collectOutputUntilDeadline({
    buffer: session.outputBuffer,
    outputNotify: session.outputNotify,
    outputClosed: session.outputClosed,
    exited: session.exited,
    deadlineMs: Date.now() + 100,
  });
  return renderResponseOutput(
    finalizeResponse({
      wallTimeSec: 0,
      collected,
      signal: session.signal,
      failure: session.failureMessage,
      tty: session.tty,
      logPath: session.logPath,
    }),
  );
}

export async function terminateSessionById(
  runtime: ExtensionRuntime,
  sessionId: number,
  initial: NodeJS.Signals,
): Promise<TerminateOutcome | undefined> {
  const session = runtime.store.get(sessionId);
  if (!session) return undefined;
  runtime.coordinator.suppress(sessionId);
  session.kill(initial);
  await waitForExit(session, 2000, 50);
  let escalated = false;
  if (!session.hasExited && !IS_WINDOWS) {
    session.kill("SIGKILL");
    escalated = true;
    await waitForExit(session, 500, 25);
  }
  const finalOutput = await drain(session);
  const killed = session.hasExited;
  if (killed) {
    runtime.coordinator.confirmKill(sessionId);
    removeSession(runtime, sessionId);
  } else {
    runtime.coordinator.restoreAfterFailedKill(sessionId);
  }
  return { session, escalated, finalOutput, killed };
}

export function untrackedLiveSessions<T extends { hasExited: boolean }>(
  tracked: readonly T[],
  pending: Iterable<T>,
): T[] {
  const known = new Set(tracked);
  return Array.from(pending).filter((session) => !known.has(session) && !session.hasExited);
}

export async function shutdownSessions(runtime: ExtensionRuntime): Promise<void> {
  runtime.shuttingDown = true;
  runtime.agentActivity.active = false;
  runtime.coordinator.shutdown();
  const drained = runtime.store.terminateAll();
  for (const session of untrackedLiveSessions(drained, runtime.pendingSessions)) {
    session.terminate();
    drained.push(session);
  }
  await waitForAll(drained, 1000);
  if (!IS_WINDOWS) {
    for (const session of drained.filter((item) => !item.hasExited)) session.kill("SIGKILL");
    await waitForAll(drained, 500);
  }
  if (drained.length && runtime.ui) {
    const leftover = drained.filter((session) => !session.hasExited).length;
    runtime.ui.notify(
      `unified-exec: terminated ${String(drained.length - leftover)} live session(s) on shutdown${leftover ? `; ${String(leftover)} did not confirm exit` : ""}`,
      leftover ? "warning" : "info",
    );
  }
}

async function waitForAll(sessions: readonly ExecSession[], durationMs: number): Promise<void> {
  const deadline = Date.now() + durationMs;
  while (sessions.some((session) => !session.hasExited) && Date.now() < deadline) await sleep(50);
}
