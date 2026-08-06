import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

import { sanitizeMeta } from "./completion.ts";
import { DEFAULT_MAX_BACKGROUND_POLL_MS } from "./constants.ts";
import { runExecCommand } from "./exec-command.ts";
import { nowUtcIso } from "./time.ts";
import {
  renderExecCommandCall,
  renderKillSessionCall,
  renderKillSessionResult,
  renderListSessionsCall,
  renderListSessionsResult,
  renderProcessResult,
  renderSetOnExitCall,
  renderSetOnExitResult,
  renderWriteStdinCall,
} from "./render.ts";
import { envelopeFromCollected } from "./response.ts";
import { removeSession, updateRunningSessionsUi } from "./session-ui.ts";
import { terminateSessionById } from "./termination.ts";
import { normalizeSignal } from "./tool-helpers.ts";
import {
  finalizeKillResult,
  renderKillResultText,
  renderProcessResultText,
} from "./tool-result.ts";
import {
  ExecCommandParameters,
  KillSessionParameters,
  ListSessionsParameters,
  SetOnExitParameters,
  WriteStdinParameters,
} from "./tool-schema.ts";
import type {
  ExtensionRuntime,
  RenderState,
  SessionListing,
  UnifiedExecDetails,
} from "./tool-types.ts";
import { runWriteStdin } from "./write-stdin.ts";

function registerExecCommand(pi: ExtensionAPI, runtime: ExtensionRuntime): void {
  const tool: ToolDefinition<typeof ExecCommandParameters, UnifiedExecDetails, RenderState> = {
    name: "exec_command",
    label: "exec_command",
    description:
      'Run a command in a persistent session. on_exit defaults to "none". Use "wake" only when the human explicitly requests auto-resume.',
    promptSnippet: "Run a shell command; long-running ones yield a session_id",
    promptGuidelines: [
      "Prefer dedicated file tools when available. Otherwise use exec_command with fast shell tools.",
      "Use a short initial yield for quick commands, then poll long-running commands with write_stdin.",
      `Use repeated empty write_stdin polls up to ${String(DEFAULT_MAX_BACKGROUND_POLL_MS)} ms for ordinary progress.`,
      'on_exit defaults to "none". Use "wake" only when the human explicitly requests auto-resume, and disarm abandoned wakes with set_on_exit.',
    ],
    parameters: ExecCommandParameters,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      runtime.ui ??= ctx.ui;
      const details = await runExecCommand(runtime, params, signal, onUpdate, ctx.cwd, ctx.model);
      updateRunningSessionsUi(runtime);
      return { content: [{ type: "text", text: renderProcessResultText(details) }], details };
    },
    renderCall: renderExecCommandCall,
    renderResult: renderProcessResult,
  };
  pi.registerTool(tool);
}

function registerWriteStdin(pi: ExtensionAPI, runtime: ExtensionRuntime): void {
  const tool: ToolDefinition<typeof WriteStdinParameters, UnifiedExecDetails, RenderState> = {
    name: "write_stdin",
    label: "write_stdin",
    description:
      "Write bytes to or poll a persistent session. Empty polls use yield_time_ms; yield_until is only for a human-requested long attached wait.",
    promptSnippet: "Send input to or poll a running session",
    promptGuidelines: [
      `Use repeated empty progress polls of at most ${String(DEFAULT_MAX_BACKGROUND_POLL_MS)} ms.`,
      "Use yield_until only when the human explicitly requests a long attached wait or UTC deadline.",
      "Never use yield_until for interactive or indefinite processes.",
      'A direct terminal result consumes an armed on_exit wake; set_on_exit with "none" disarms without killing.',
      "Submit TTY lines with \\r for portable Enter-key behavior.",
    ],
    parameters: WriteStdinParameters,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      runtime.ui ??= ctx.ui;
      const details = await runWriteStdin(runtime, params, signal, onUpdate, toolCallId);
      updateRunningSessionsUi(runtime);
      return { content: [{ type: "text", text: renderProcessResultText(details) }], details };
    },
    renderCall: renderWriteStdinCall,
    renderResult: renderProcessResult,
  };
  pi.registerTool(tool);
}

function registerSetOnExit(pi: ExtensionAPI, runtime: ExtensionRuntime): void {
  const tool: ToolDefinition<typeof SetOnExitParameters, UnifiedExecDetails, RenderState> = {
    name: "set_on_exit",
    label: "set_on_exit",
    description:
      'Change completion policy without killing the process. "none" disarms; "wake" arms human-requested auto-resume.',
    promptSnippet: "Disarm or re-arm completion wake for a session",
    promptGuidelines: [
      'Default on_exit is "none". Disarm stale or abandoned wakes promptly.',
      "set_on_exit does not stop the process; use kill_session to terminate it.",
    ],
    parameters: SetOnExitParameters,
    // eslint-disable-next-line complexity -- Keep set_on_exit state reporting aligned with coordinator outcomes.
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      runtime.ui ??= ctx.ui;
      const session = runtime.store.get(params.session_id);
      if (params.on_exit === "wake" && !session)
        return Promise.resolve(notFound(params.session_id));
      const status = runtime.coordinator.setOnExit(params.session_id, params.on_exit, session);
      if (!session && status === "already_none")
        return Promise.resolve(notFound(params.session_id));
      const details: UnifiedExecDetails = {
        session_id: params.session_id,
        found: true,
        on_exit: params.on_exit,
        status,
        running: session ? !session.hasExited : false,
        wake_armed: runtime.coordinator.isArmed(params.session_id),
        command: session?.displayCommand,
        log_path: session?.logPath,
        tool_time_utc: nowUtcIso(),
      };
      const text = `set_on_exit session_id=${String(params.session_id)} on_exit=${params.on_exit} → ${status}; wake ${details.wake_armed ? "armed" : "not armed"}`;
      return Promise.resolve({ content: [{ type: "text", text }], details });
    },
    renderCall: renderSetOnExitCall,
    renderResult: renderSetOnExitResult,
  };
  pi.registerTool(tool);
}

function notFound(sessionId: number): {
  content: [{ type: "text"; text: string }];
  details: UnifiedExecDetails;
} {
  return {
    content: [{ type: "text", text: `No such session: ${String(sessionId)}` }],
    details: { session_id: sessionId, found: false, running: false },
  };
}

function registerKillSession(pi: ExtensionAPI, runtime: ExtensionRuntime): void {
  const tool: ToolDefinition<typeof KillSessionParameters, UnifiedExecDetails, RenderState> = {
    name: "kill_session",
    label: "kill_session",
    description:
      "Terminate a session with SIGTERM and bounded SIGKILL escalation. Killing also suppresses any armed wake.",
    promptSnippet: "Terminate a session",
    parameters: KillSessionParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      runtime.ui ??= ctx.ui;
      const initial = normalizeSignal(params.signal);
      const startedAt = Date.now();
      const outcome = await terminateSessionById(runtime, params.session_id, initial);
      if (!outcome) return notFound(params.session_id);
      updateRunningSessionsUi(runtime);
      const { session, escalated, collected, killed } = outcome;
      const killFailure = killed
        ? session.failureMessage
        : [
            `process still running after ${initial}${escalated ? " and SIGKILL escalation" : ""}; ` +
              "the session remains registered — retry kill_session or check permissions",
            session.failureMessage,
          ]
            .filter((value): value is string => Boolean(value))
            .join("; ");
      const details = finalizeKillResult({
        wallTimeSec: (Date.now() - startedAt) / 1000,
        ...envelopeFromCollected(collected),
        totalBytes: session.totalBytesSeen,
        sessionId: params.session_id,
        pid: session.pid,
        requestedSignal: initial,
        exitCode: session.exitCode,
        signal: session.signal,
        failure: killFailure || null,
        tty: session.tty,
        logPath: session.logPath,
        cwd: session.cwd,
        command: session.displayCommand,
        escalated,
        killed,
      });
      return {
        content: [{ type: "text", text: renderKillResultText(details) }],
        details,
      };
    },
    renderCall: renderKillSessionCall,
    renderResult: renderKillSessionResult,
  };
  pi.registerTool(tool);
}

function listing(
  runtime: ExtensionRuntime,
  now: number,
  sessionId: number,
): SessionListing | undefined {
  const session = runtime.store.get(sessionId);
  if (!session) return undefined;
  return {
    session_id: session.id,
    command: session.displayCommand,
    cwd: session.cwd,
    tty: session.tty,
    pid: session.pid,
    started_at_ms: session.startedAt,
    elapsed_ms: now - session.startedAt,
    running: !session.hasExited,
    wake_armed: runtime.coordinator.isArmed(session.id),
    exit_code: session.hasExited ? session.exitCode : undefined,
    signal: session.hasExited ? (session.signal ?? undefined) : undefined,
    failure_message: session.failureMessage ?? undefined,
    output_bytes_total: session.totalBytesSeen,
    log_path: session.logPath,
  };
}

function oneLineCommand(command: string, max = 60): string {
  // sanitizeMeta strips control chars (ESC included) before the preview.
  const oneLine = sanitizeMeta(command).replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function sessionListingText(session: SessionListing): string {
  const exitedSuffix = session.running
    ? ""
    : `  [exited${session.exit_code !== undefined && session.exit_code !== null ? ` exit_code=${String(session.exit_code)}` : ""}${session.signal ? ` signal=${session.signal}` : ""}; removed from store]`;
  const wake = session.wake_armed ? " [wake]" : "";
  return `  ${String(session.session_id).padStart(3)}  pid=${String(session.pid ?? "?").padStart(6)}  ${
    session.tty ? "tty" : "pipe"
  }  ${((session.elapsed_ms / 1000).toFixed(1) + "s").padStart(8)}${wake}  ${oneLineCommand(session.command)}${exitedSuffix}\n        log: ${session.log_path}`;
}

function registerListSessions(pi: ExtensionAPI, runtime: ExtensionRuntime): void {
  const tool: ToolDefinition<typeof ListSessionsParameters, UnifiedExecDetails, RenderState> = {
    name: "list_sessions",
    label: "list_sessions",
    description: "List live sessions and report newly exited sessions once before removing them.",
    promptSnippet: "List live command sessions",
    parameters: ListSessionsParameters,
    execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      runtime.ui ??= ctx.ui;
      const now = Date.now();
      const ids = runtime.store.values().map((session) => session.id);
      const sessions = ids
        .map((id) => listing(runtime, now, id))
        .filter((item) => item !== undefined);
      for (const session of sessions.filter((item) => !item.running)) {
        runtime.coordinator.observeViaListing(session.session_id);
        removeSession(runtime, session.session_id);
      }
      updateRunningSessionsUi(runtime);
      const activeCount = sessions.filter((session) => session.running).length;
      const reapedCount = sessions.length - activeCount;
      const lines = sessions.length ? sessions.map(sessionListingText) : ["  (no live sessions)"];
      // tool_time_utc lets the model compute a yield_until deadline from a
      // trustworthy host clock without an extra probing call.
      const toolTimeUtc = nowUtcIso();
      const header = reapedCount
        ? `unified-exec sessions (${String(activeCount)} live, ${String(reapedCount)} just exited):`
        : `unified-exec sessions (${String(activeCount)} live):`;
      const details: UnifiedExecDetails = {
        sessions,
        active_count: activeCount,
        just_exited_count: reapedCount,
        tool_time_utc: toolTimeUtc,
      };
      return Promise.resolve({
        content: [
          {
            type: "text",
            text: `${header}\n${lines.join("\n")}\ntool_time_utc: ${toolTimeUtc}`,
          },
        ],
        details,
      });
    },
    renderCall: renderListSessionsCall,
    renderResult: renderListSessionsResult,
  };
  pi.registerTool(tool);
}

export function registerTools(pi: ExtensionAPI, runtime: ExtensionRuntime): void {
  registerExecCommand(pi, runtime);
  registerWriteStdin(pi, runtime);
  registerSetOnExit(pi, runtime);
  registerKillSession(pi, runtime);
  registerListSessions(pi, runtime);
}
