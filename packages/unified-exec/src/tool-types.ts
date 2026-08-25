import type {
  AgentToolUpdateCallback,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

import type { CompletionCoordinator, OnExitPolicy } from "./completion.ts";
import type { PrepareCommandEnvironment } from "./command-environment.ts";
import type { SessionStore } from "./session-store.ts";
import type { ExecSession } from "./session.ts";
import type { TruncationMetadata } from "./tool-result.ts";

export type WaitMode = "relative" | "absolute";
export type WaitStatus =
  | "completed"
  | "relative_deadline_reached"
  | "absolute_deadline_reached"
  | "cancelled";

export type SessionListing = Readonly<{
  session_id: number;
  command: string;
  cwd: string;
  tty: boolean;
  pid?: number | undefined;
  started_at_ms: number;
  elapsed_ms: number;
  running: boolean;
  wake_armed: boolean;
  exit_code?: number | null | undefined;
  signal?: string | undefined;
  failure_message?: string | undefined;
  output_bytes_total: number;
  log_path: string;
}>;

export type UnifiedExecDetails = Readonly<{
  operation?: "exec_command" | "write_stdin" | "kill_session" | undefined;
  chunk_id?: string | undefined;
  wall_time_seconds?: number | undefined;
  output?: string | undefined;
  original_token_count?: number | undefined;
  session_id?: number | undefined;
  pid?: number | undefined;
  total_bytes?: number | undefined;
  exit_code?: number | null | undefined;
  signal?: string | undefined;
  failure_message?: string | undefined;
  tty?: boolean | undefined;
  log_path?: string | undefined;
  cwd?: string | undefined;
  command?: string | undefined;
  yield_time_ms?: number | undefined;
  truncation?: TruncationMetadata | undefined;
  omitted_bytes?: number | undefined;
  output_bytes_total?: number | undefined;
  wait_mode?: WaitMode | undefined;
  wait_status?: WaitStatus | undefined;
  yield_until?: string | undefined;
  effective_wait_ms?: number | undefined;
  on_exit?: OnExitPolicy | undefined;
  completion_notification?: "armed" | undefined;
  completion_delivery?: "direct" | undefined;
  on_exit_wake?: "consumed" | undefined;
  tool_time_utc?: string | undefined;
  found?: boolean | undefined;
  status?: string | undefined;
  running?: boolean | undefined;
  wake_armed?: boolean | undefined;
  requested_signal?: string | undefined;
  escalated?: boolean | undefined;
  killed?: boolean | undefined;
  sessions?: readonly SessionListing[] | undefined;
  active_count?: number | undefined;
  just_exited_count?: number | undefined;
}>;

export type ToolUpdate = AgentToolUpdateCallback<UnifiedExecDetails>;

export type RenderState = {
  startedAt?: number | undefined;
  endedAt?: number | undefined;
  liveTicker?: NodeJS.Timeout | undefined;
  cachedWidth?: number | undefined;
  cachedBody?: string | undefined;
  cachedLines?: string[] | undefined;
  cachedSkipped?: number | undefined;
};

type BaseRenderContext = Parameters<
  NonNullable<ToolDefinition<TSchema, UnifiedExecDetails, RenderState>["renderResult"]>
>[3];

export type UnifiedRenderContext<TArgs> = Omit<BaseRenderContext, "args"> & { args: TArgs };

export type AgentActivity = { active: boolean };

export type ExtensionUi = Pick<
  ExtensionContext["ui"],
  "notify" | "select" | "setStatus" | "setWidget"
>;

export type ExtensionRuntime = {
  store: SessionStore;
  coordinator: CompletionCoordinator;
  ui: ExtensionUi | undefined;
  widgetVisible: boolean;
  exitUnsubscribers: Map<number, () => void>;
  warnedShellFallback: boolean;
  notifiedBashSource: boolean;
  pendingSessions: Set<ExecSession>;
  prepareEnvironment: PrepareCommandEnvironment;
  shuttingDown: boolean;
  agentActivity: AgentActivity;
};
