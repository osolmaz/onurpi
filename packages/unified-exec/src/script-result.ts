/**
 * Script-facing results for Pi codemode.
 *
 * Pi codemode hands a nested tool call's `structuredContent` to the script
 * when the tool declares an `outputSchema`; otherwise the script receives the
 * whole text envelope as one string. Printing that string inside an object
 * (`text({ ...r })`) serializes every newline as `\n`, producing one logical
 * line that codemode's five-line collapsed preview cannot bound.
 *
 * These projections give scripts `output` as a real multi-line string plus
 * typed state (`exit_code`, `session_id`, …). They derive only from the
 * already-bounded, sanitized result details, so they add no new size or
 * terminal-safety surface. Model-visible `content` and persisted `details`
 * are unchanged.
 */

import { Type, type Static } from "typebox";

import type { OnExitPolicy } from "./completion.ts";
import {
  type KillResultDetails,
  type ProcessResultDetails,
  safeMeta,
  WAIT_STATUSES,
} from "./tool-result.ts";
import { stringEnum } from "./tool-schema.ts";
import type { SessionListing } from "./tool-types.ts";

/** `{ [key]: value }` when the value is defined, else `{}`: spread it into a result. */
function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  const field: Partial<Record<K, V>> = {};
  if (value !== undefined) field[key] = value;
  return field;
}

/** Bounded, single-line metadata, or undefined when the value is empty. */
function meta(value: string | null | undefined): string | undefined {
  return value ? safeMeta(value) : undefined;
}

const OnExitSchema = stringEnum(["none", "wake"] as const);
const WaitStatusSchema = stringEnum(WAIT_STATUSES);

const outputFields = {
  output: Type.String({
    description:
      "Bounded, terminal-safe tail of the child output with real newlines. Print it with text(r.output) rather than printing the whole result object.",
  }),
  truncated: Type.Boolean({
    description: "True when earlier output was dropped; the full stream is in log_path.",
  }),
  omitted_bytes: Type.Optional(
    Type.Number({ description: "Middle bytes dropped by the in-memory retention cap." }),
  ),
  exit_code: Type.Optional(Type.Number({ description: "Exit code once the process has exited." })),
  signal: Type.Optional(
    Type.String({ description: "Signal that terminated the process, if any." }),
  ),
  failure_message: Type.Optional(Type.String()),
  log_path: Type.Optional(
    Type.String({ description: "File containing the complete output stream." }),
  ),
  wall_time_seconds: Type.Number(),
};

type OutputFields = Static<ReturnType<typeof Type.Object<typeof outputFields>>>;

function outputScriptFields(details: ProcessResultDetails | KillResultDetails): OutputFields {
  return {
    output: details.output,
    truncated: details.truncation?.truncated === true,
    ...optional("omitted_bytes", details.omitted_bytes || undefined),
    ...optional("exit_code", details.exit_code),
    ...optional("signal", meta(details.signal)),
    ...optional("failure_message", meta(details.failure_message)),
    ...optional("log_path", meta(details.log_path)),
    wall_time_seconds: details.wall_time_seconds,
  };
}

export const processScriptResultSchema = Type.Object({
  status: Type.Union([Type.Literal("running"), Type.Literal("exited")]),
  running: Type.Boolean(),
  session_id: Type.Optional(
    Type.Number({
      description: "Present while the process is still running; drive it with write_stdin.",
    }),
  ),
  ...outputFields,
  note: Type.Optional(Type.String()),
  wait_status: Type.Optional(WaitStatusSchema),
  on_exit: Type.Optional(OnExitSchema),
  tool_time_utc: Type.Optional(
    Type.String({ description: "Host UTC time, for computing yield_until deadlines." }),
  ),
});
export type ProcessScriptResult = Static<typeof processScriptResultSchema>;

export function processScriptResult(details: ProcessResultDetails): ProcessScriptResult {
  return {
    status: details.status,
    running: details.running,
    ...optional("session_id", details.session_id),
    ...outputScriptFields(details),
    ...optional("note", meta(details.note)),
    ...optional("wait_status", details.wait_status),
    ...optional("on_exit", details.on_exit),
    ...optional("tool_time_utc", details.tool_time_utc),
  };
}

export const killScriptResultSchema = Type.Object({
  status: Type.Union([Type.Literal("killed"), Type.Literal("kill_failed")]),
  found: Type.Boolean({ description: "False when no session had this id." }),
  killed: Type.Boolean(),
  running: Type.Boolean({
    description: "True when the kill was not confirmed and the session remains registered.",
  }),
  escalated: Type.Boolean({ description: "True when SIGKILL escalation was needed." }),
  session_id: Type.Number(),
  ...outputFields,
});
export type KillScriptResult = Static<typeof killScriptResultSchema>;

export function killScriptResult(details: KillResultDetails): KillScriptResult {
  return {
    status: details.status,
    found: true,
    killed: details.killed,
    running: details.running,
    escalated: details.escalated,
    session_id: details.session_id,
    ...outputScriptFields(details),
  };
}

export function killNotFoundScriptResult(sessionId: number): KillScriptResult {
  return {
    status: "kill_failed",
    found: false,
    killed: false,
    running: false,
    escalated: false,
    session_id: sessionId,
    output: "",
    truncated: false,
    wall_time_seconds: 0,
  };
}

export const setOnExitScriptResultSchema = Type.Object({
  session_id: Type.Number(),
  found: Type.Boolean({ description: "False when no session or pending wake had this id." }),
  on_exit: Type.Optional(OnExitSchema),
  status: Type.Optional(Type.String()),
  running: Type.Optional(Type.Boolean()),
  wake_armed: Type.Optional(Type.Boolean()),
});
export type SetOnExitScriptResult = Static<typeof setOnExitScriptResultSchema>;

export function setOnExitScriptResult(
  value: Readonly<{
    session_id: number;
    found: boolean;
    on_exit?: OnExitPolicy | undefined;
    status?: string | undefined;
    running?: boolean | undefined;
    wake_armed?: boolean | undefined;
  }>,
): SetOnExitScriptResult {
  return {
    session_id: value.session_id,
    found: value.found,
    ...optional("on_exit", value.on_exit),
    ...optional("status", value.status),
    ...optional("running", value.running),
    ...optional("wake_armed", value.wake_armed),
  };
}

const sessionScriptSchema = Type.Object({
  session_id: Type.Number(),
  command: Type.String(),
  cwd: Type.Optional(Type.String()),
  tty: Type.Boolean(),
  pid: Type.Optional(Type.Number()),
  elapsed_ms: Type.Number(),
  running: Type.Boolean({
    description: "False for sessions that just exited; they are removed after this listing.",
  }),
  wake_armed: Type.Boolean(),
  exit_code: Type.Optional(Type.Number()),
  signal: Type.Optional(Type.String()),
  log_path: Type.Optional(Type.String()),
});
type SessionScriptResult = Static<typeof sessionScriptSchema>;

export const listSessionsScriptResultSchema = Type.Object({
  sessions: Type.Array(sessionScriptSchema),
  active_count: Type.Number(),
  just_exited_count: Type.Number(),
  tool_time_utc: Type.String(),
});
export type ListSessionsScriptResult = Static<typeof listSessionsScriptResultSchema>;

function sessionScriptResult(session: SessionListing): SessionScriptResult {
  return {
    session_id: session.session_id,
    command: safeMeta(session.command),
    ...optional("cwd", meta(session.cwd)),
    tty: session.tty,
    ...optional("pid", session.pid),
    elapsed_ms: session.elapsed_ms,
    running: session.running,
    wake_armed: session.wake_armed,
    ...optional("exit_code", session.exit_code ?? undefined),
    ...optional("signal", meta(session.signal)),
    ...optional("log_path", meta(session.log_path)),
  };
}

export function listSessionsScriptResult(
  value: Readonly<{
    sessions: readonly SessionListing[];
    active_count: number;
    just_exited_count: number;
    tool_time_utc: string;
  }>,
): ListSessionsScriptResult {
  return {
    sessions: value.sessions.map(sessionScriptResult),
    active_count: value.active_count,
    just_exited_count: value.just_exited_count,
    tool_time_utc: value.tool_time_utc,
  };
}
