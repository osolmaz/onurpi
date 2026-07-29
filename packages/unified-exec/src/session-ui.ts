import { formatElapsed } from "./format-time.ts";
import type { ExecSession } from "./session.ts";
import { SESSION_UI_KEY } from "./constants.ts";
import type { ExtensionRuntime } from "./tool-types.ts";

export function runningSessions(runtime: ExtensionRuntime): ExecSession[] {
  return runtime.store
    .values()
    .filter((session) => !session.hasExited)
    .sort((left, right) => left.id - right.id);
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

function oneLineCommand(command: string, max = 120): string {
  const oneLine = command.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function sessionLine(runtime: ExtensionRuntime, session: ExecSession, now: number): string {
  const wake = runtime.coordinator.isArmed(session.id) ? " ⏰wake" : "";
  return `  #${String(session.id)} ${formatElapsed(now - session.startedAt)}${wake} ${oneLineCommand(session.displayCommand, 72)} (${session.cwd})`;
}

function widgetLines(runtime: ExtensionRuntime, sessions: readonly ExecSession[]): string[] {
  const now = Date.now();
  const shown = sessions.slice(0, 5);
  const lines = [
    `⚠ unified-exec: ${String(sessions.length)} ${plural(sessions.length, "session")} still running`,
    ...shown.map((session) => sessionLine(runtime, session, now)),
  ];
  if (sessions.length > shown.length) {
    lines.push(`  … ${String(sessions.length - shown.length)} more; use list_sessions`);
  }
  lines.push("  Use list_sessions, write_stdin, set_on_exit, or kill_session.");
  return lines;
}

// eslint-disable-next-line complexity -- Keep status and widget transitions atomic.
export function updateRunningSessionsUi(
  runtime: ExtensionRuntime,
  options: Readonly<{ showWidget?: boolean; notifyTree?: boolean }> = {},
): void {
  const ui = runtime.ui;
  if (!ui) return;
  const sessions = runningSessions(runtime);
  const status = sessions.length
    ? `unified-exec: ${String(sessions.length)} ${plural(sessions.length, "session")} running`
    : undefined;
  ui.setStatus(SESSION_UI_KEY, status);
  if (options.notifyTree && sessions.length > 0) {
    ui.notify(
      `unified-exec: ${String(sessions.length)} ${plural(sessions.length, "session")} still running after /tree.`,
      "warning",
    );
  }
  if (sessions.length === 0) {
    if (runtime.widgetVisible) ui.setWidget(SESSION_UI_KEY, undefined);
    runtime.widgetVisible = false;
  } else if (options.showWidget || runtime.widgetVisible) {
    ui.setWidget(SESSION_UI_KEY, widgetLines(runtime, sessions), { placement: "aboveEditor" });
    runtime.widgetVisible = true;
  }
}

export function watchSessionExit(runtime: ExtensionRuntime, session: ExecSession): void {
  unwatchSessionExit(runtime, session.id);
  const unsubscribe = session.onExit(() => updateRunningSessionsUi(runtime));
  runtime.exitUnsubscribers.set(session.id, unsubscribe);
}

export function unwatchSessionExit(runtime: ExtensionRuntime, id: number): void {
  runtime.exitUnsubscribers.get(id)?.();
  runtime.exitUnsubscribers.delete(id);
}

export function removeSession(runtime: ExtensionRuntime, id: number): ExecSession | undefined {
  unwatchSessionExit(runtime, id);
  return runtime.store.remove(id);
}

export function clearSessionExitWatchers(runtime: ExtensionRuntime): void {
  for (const unsubscribe of runtime.exitUnsubscribers.values()) unsubscribe();
  runtime.exitUnsubscribers.clear();
}

export function formatSessionChoice(
  runtime: ExtensionRuntime,
  session: ExecSession,
  now: number,
): string {
  const wake = runtime.coordinator.isArmed(session.id) ? " ⏰wake" : "";
  return `#${String(session.id)} ${formatElapsed(now - session.startedAt)}${wake} ${oneLineCommand(session.displayCommand, 60)}`;
}
