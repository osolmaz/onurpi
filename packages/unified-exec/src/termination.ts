import { type CollectedOutput, collectOutputUntilDeadline } from "./collect.ts";
import { waitForExitOrDeadline } from "./long-wait.ts";
import { removeSession } from "./session-ui.ts";
import type { ExecSession } from "./session.ts";
import { IS_WINDOWS } from "./shell.ts";
import type { ExtensionRuntime } from "./tool-types.ts";

export type TerminateOutcome = Readonly<{
  session: ExecSession;
  escalated: boolean;
  collected: CollectedOutput;
  /** true when the process is confirmed dead; false = kill did NOT land. */
  killed: boolean;
}>;

export async function terminateSessionById(
  runtime: ExtensionRuntime,
  sessionId: number,
  initial: NodeJS.Signals,
): Promise<TerminateOutcome | undefined> {
  const session = runtime.store.get(sessionId);
  if (!session) return undefined;
  // Suppress a pending wake for this session BEFORE signaling so the induced
  // exit can never race a wake enqueue.
  runtime.coordinator.suppress(sessionId);
  session.kill(initial);
  // Event-driven wait (resolves the instant the exit fires): up to 2s.
  await waitForExitOrDeadline({ exited: session.exited, durationMs: 2000 });
  let escalated = false;
  // On Windows every kill is already a force tree-kill (taskkill /T /F);
  // a "SIGKILL escalation" would spawn a byte-identical taskkill that
  // accomplishes nothing, so skip it there.
  if (!session.hasExited && !IS_WINDOWS) {
    session.kill("SIGKILL");
    escalated = true;
    await waitForExitOrDeadline({ exited: session.exited, durationMs: 500 });
  }
  // Final bounded drain; the complete stream remains in the session log.
  const collected = await collectOutputUntilDeadline({
    buffer: session.outputBuffer,
    outputNotify: session.outputNotify,
    outputClosed: session.outputClosed,
    exited: session.exited,
    deadlineMs: Date.now() + 100,
  });
  const killed = session.hasExited;
  if (killed) {
    runtime.coordinator.confirmKill(sessionId);
    removeSession(runtime, sessionId);
  } else {
    // Kill failed (still alive after escalation). Restore its prior wake
    // eligibility.
    runtime.coordinator.restoreAfterFailedKill(sessionId);
  }
  return { session, escalated, collected, killed };
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
  // Event-driven per session: each wait resolves the instant that session's
  // exit fires. On Windows the initial kill is already a force tree-kill and
  // a second taskkill is byte-identical, so skip the escalation there (the
  // grace wait above still confirms exits).
  await Promise.all(
    drained.map((session) => waitForExitOrDeadline({ exited: session.exited, durationMs: 1000 })),
  );
  if (!IS_WINDOWS) {
    const survivors = drained.filter((session) => !session.hasExited);
    for (const session of survivors) session.kill("SIGKILL");
    await Promise.all(
      survivors.map((session) =>
        waitForExitOrDeadline({ exited: session.exited, durationMs: 500 }),
      ),
    );
  }
  if (drained.length && runtime.ui) {
    const leftover = drained.filter((session) => !session.hasExited).length;
    runtime.ui.notify(
      `unified-exec: terminated ${String(drained.length - leftover)} live session(s) on shutdown${leftover ? `; ${String(leftover)} did not confirm exit` : ""}`,
      leftover ? "warning" : "info",
    );
  }
}
