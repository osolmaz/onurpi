import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

import {
  DEFAULT_EXEC_YIELD_MS,
  DEFAULT_MAX_BACKGROUND_POLL_MS,
  DEFAULT_WRITE_STDIN_YIELD_MS,
  MAX_YIELD_TIME_MS,
  MIN_EMPTY_YIELD_TIME_MS,
  MIN_YIELD_TIME_MS,
} from "./constants.ts";

export const ExecCommandParameters = Type.Object({
  cmd: Type.String({ description: "Shell command to execute." }),
  workdir: Type.Optional(
    Type.String({ description: "Working directory. Defaults to the session cwd." }),
  ),
  shell: Type.Optional(
    Type.String({
      description:
        "Shell binary. Defaults to bash (on Windows: bash if available, else PowerShell). Shell-specific flags are applied automatically.",
    }),
  ),
  tty: Type.Optional(Type.Boolean({ description: "Allocate a PTY. Default false." })),
  yield_time_ms: Type.Optional(
    Type.Number({
      description: `Initial attachment window in milliseconds. Default ${String(DEFAULT_EXEC_YIELD_MS)}, clamped to ${String(MIN_YIELD_TIME_MS)}-${String(MAX_YIELD_TIME_MS)}.`,
    }),
  ),
  on_exit: Type.Optional(
    StringEnum(["none", "wake"] as const, {
      description:
        '"none" (default): poll manually. "wake": send one follow-up on an unobserved exit, only when the human explicitly requests auto-resume.',
    }),
  ),
});

export const WriteStdinParameters = Type.Object({
  session_id: Type.Number({ description: "Session id from exec_command." }),
  chars: Type.Optional(
    Type.String({
      description:
        "Text with C-style escapes, including \\xHH, \\uHHHH, \\n, and \\r. Mutually exclusive with chars_b64.",
    }),
  ),
  chars_b64: Type.Optional(
    Type.String({ description: "Raw bytes encoded as base64. Mutually exclusive with chars." }),
  ),
  yield_time_ms: Type.Optional(
    Type.Number({
      description: `Attachment window in milliseconds. Empty polls use ${String(MIN_EMPTY_YIELD_TIME_MS)}-${String(DEFAULT_MAX_BACKGROUND_POLL_MS)}; input writes use ${String(MIN_YIELD_TIME_MS)}-${String(MAX_YIELD_TIME_MS)}. Default ${String(DEFAULT_WRITE_STDIN_YIELD_MS)} before clamping.`,
    }),
  ),
  yield_until: Type.Optional(
    Type.String({
      description:
        'Absolute RFC 3339 UTC deadline for an empty poll, only when the human explicitly requests a long attached wait. Example: "2026-07-21T18:30:00Z".',
    }),
  ),
});

export const SetOnExitParameters = Type.Object({
  session_id: Type.Number({ description: "Session id from exec_command." }),
  on_exit: StringEnum(["none", "wake"] as const, {
    description:
      '"none": disarm wake without killing. "wake": arm auto-resume for a running session.',
  }),
});

export const KillSessionParameters = Type.Object({
  session_id: Type.Number({ description: "Session to terminate." }),
  signal: Type.Optional(
    Type.String({
      description: 'Initial signal, defaulting to "SIGTERM". Examples: SIGINT or SIGKILL.',
    }),
  ),
});

export const ListSessionsParameters = Type.Object({});

export type ExecCommandArgs = Static<typeof ExecCommandParameters>;
export type WriteStdinArgs = Static<typeof WriteStdinParameters>;
export type SetOnExitArgs = Static<typeof SetOnExitParameters>;
export type KillSessionArgs = Static<typeof KillSessionParameters>;
export type ListSessionsArgs = Static<typeof ListSessionsParameters>;
