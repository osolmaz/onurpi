import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

import { DEFAULT_MAX_BACKGROUND_POLL_MS } from "./constants.ts";
import { runExecCommand } from "./exec-command.ts";
import { nowUtcIso } from "./time.ts";
import { renderResponseText } from "./response.ts";
import {
  renderExecCommandCall,
  renderResult,
  renderSetOnExitCall,
  renderWriteStdinCall,
} from "./render.ts";
import { removeSession, updateRunningSessionsUi } from "./session-ui.ts";
import { terminateSessionById } from "./termination.ts";
import { normalizeSignal } from "./tool-helpers.ts";
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
      const details = await runExecCommand(runtime, params, signal, onUpdate, ctx.cwd);
      updateRunningSessionsUi(runtime);
      return { content: [{ type: "text", text: renderResponseText(details) }], details };
    },
    renderCall: renderExecCommandCall,
    renderResult,
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
      return { content: [{ type: "text", text: renderResponseText(details) }], details };
    },
    renderCall: renderWriteStdinCall,
    renderResult,
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
    renderResult,
  };
  pi.registerTool(tool);
}

function notFound(sessionId: number): {
  content: [{ type: "text"; text: string }];
  details: UnifiedExecDetails;
} {
  return {
    content: [{ type: "text", text: `No such session: ${String(sessionId)}` }],
    details: { session_id: sessionId, found: false },
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
      const outcome = await terminateSessionById(runtime, params.session_id, initial);
      if (!outcome) return notFound(params.session_id);
      updateRunningSessionsUi(runtime);
      const details: UnifiedExecDetails = {
        session_id: params.session_id,
        final_output: outcome.finalOutput,
        exit_code: outcome.session.exitCode,
        signal: outcome.session.signal ?? undefined,
        escalated: outcome.escalated,
        killed: outcome.killed,
        log_path: outcome.session.logPath,
      };
      const text = outcome.killed
        ? `Killed session ${String(params.session_id)} with ${initial}${outcome.escalated ? "; escalated to SIGKILL" : ""}`
        : `FAILED to terminate session ${String(params.session_id)}; it remains registered`;
      return {
        content: [{ type: "text", text: `${text}\n---\n${outcome.finalOutput || "(no output)"}` }],
        details,
      };
    },
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

function sessionListingText(session: SessionListing): string {
  const state = session.running
    ? "running"
    : `exited${session.exit_code == null ? "" : ` exit_code=${String(session.exit_code)}`}`;
  const wake = session.wake_armed ? " wake" : "";
  return `  ${String(session.session_id).padStart(3)}  ${state}${wake}  ${session.command}\n      log: ${session.log_path}`;
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
      const lines = sessions.length ? sessions.map(sessionListingText) : ["  (no live sessions)"];
      const details: UnifiedExecDetails = { sessions, active_count: activeCount };
      return Promise.resolve({
        content: [
          {
            type: "text",
            text: `unified-exec sessions (${String(activeCount)} live):\n${lines.join("\n")}`,
          },
        ],
        details,
      });
    },
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
