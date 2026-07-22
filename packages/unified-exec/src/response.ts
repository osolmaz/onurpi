import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateTail,
  type TruncationResult,
} from "@earendil-works/pi-coding-agent";
import { randomBytes } from "node:crypto";

import type { FinalResponseDetails, UnifiedExecDetails } from "./tool-types.ts";

const textDecoder = new TextDecoder("utf-8", { fatal: false });
const textEncoder = new TextEncoder();

export function decode(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function encode(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function generateChunkId(): string {
  return randomBytes(3).toString("hex");
}

function truncationMarker(
  truncation: TruncationResult,
  logPath: string | undefined,
): string | undefined {
  if (!truncation.truncated) return undefined;
  const full = logPath ? `. Full output: ${logPath}` : "";
  if (truncation.lastLinePartial) {
    return `[Showing last ${formatSize(truncation.outputBytes)} of final line (line ${String(truncation.totalLines)} is larger than the ${formatSize(DEFAULT_MAX_BYTES)} limit)${full}]`;
  }
  const startLine = truncation.totalLines - truncation.outputLines + 1;
  if (truncation.truncatedBy === "lines") {
    return `[Showing lines ${String(startLine)}-${String(truncation.totalLines)} of ${String(truncation.totalLines)}${full}]`;
  }
  return `[Showing lines ${String(startLine)}-${String(truncation.totalLines)} of ${String(truncation.totalLines)} (${formatSize(DEFAULT_MAX_BYTES)} limit)${full}]`;
}

// eslint-disable-next-line complexity -- Preserve the stable response field ordering and optional metadata.
export function renderResponseText(shape: FinalResponseDetails): string {
  const lines = [shape.session_id === undefined ? "[exited]" : "[still running]"];
  if (shape.session_id !== undefined) lines.push(`session_id: ${String(shape.session_id)}`);
  if (shape.exit_code !== undefined) lines.push(`exit_code: ${String(shape.exit_code)}`);
  if (shape.signal) lines.push(`signal: ${shape.signal}`);
  if (shape.failure_message) lines.push(`failure: ${shape.failure_message}`);
  if (shape.wait_mode) lines.push(`wait_mode: ${shape.wait_mode}`);
  if (shape.wait_status) lines.push(`wait_status: ${shape.wait_status}`);
  if (shape.yield_until) lines.push(`yield_until: ${shape.yield_until}`);
  if (shape.effective_wait_ms !== undefined)
    lines.push(`effective_wait_ms: ${String(shape.effective_wait_ms)}`);
  if (shape.on_exit) lines.push(`on_exit: ${shape.on_exit}`);
  if (shape.completion_notification)
    lines.push(`completion_notification: ${shape.completion_notification}`);
  if (shape.completion_delivery) lines.push(`completion_delivery: ${shape.completion_delivery}`);
  if (shape.on_exit_wake) lines.push(`on_exit_wake: ${shape.on_exit_wake}`);
  if (shape.tool_time_utc) lines.push(`tool_time_utc: ${shape.tool_time_utc}`);
  if (shape.log_path) lines.push(`log_path: ${shape.log_path}`);
  if (shape.cwd) lines.push(`cwd: ${shape.cwd}`);
  lines.push(`wall_time_seconds: ${shape.wall_time_seconds.toFixed(3)}`);
  lines.push(`chunk_id: ${shape.chunk_id}`);
  lines.push(`original_token_count: ${String(shape.original_token_count)}`);
  lines.push(`tty: ${String(shape.tty)}`);
  const marker = shape.truncation ? truncationMarker(shape.truncation, shape.log_path) : undefined;
  return `${lines.join("\n")}\n---\n${shape.output || "(no output)"}${marker ? `\n\n${marker}` : ""}`;
}

export type FinalizeInput = Readonly<{
  wallTimeSec: number;
  collected: Uint8Array;
  sessionId?: number | undefined;
  exitCode?: number | null | undefined;
  signal: NodeJS.Signals | null;
  failure: string | null;
  tty: boolean;
  logPath?: string | undefined;
  cwd?: string | undefined;
  command?: string | undefined;
  yieldTimeMs?: number | undefined;
  extra?: UnifiedExecDetails | undefined;
}>;

// eslint-disable-next-line complexity -- Preserve omission semantics for optional response fields.
export function finalizeResponse(input: FinalizeInput): FinalResponseDetails {
  const rawText = decode(input.collected);
  const truncation = truncateTail(rawText, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  return {
    ...input.extra,
    chunk_id: generateChunkId(),
    wall_time_seconds: input.wallTimeSec,
    output: truncation.content,
    original_token_count: Math.ceil(input.collected.length / 4),
    tty: input.tty,
    ...(input.sessionId === undefined ? {} : { session_id: input.sessionId }),
    ...(input.exitCode === undefined ? {} : { exit_code: input.exitCode }),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.failure ? { failure_message: input.failure } : {}),
    ...(input.logPath ? { log_path: input.logPath } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.command ? { command: input.command } : {}),
    ...(input.yieldTimeMs ? { yield_time_ms: input.yieldTimeMs } : {}),
    ...(truncation.truncated ? { truncation } : {}),
  };
}
