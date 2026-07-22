import { OUTPUT_POLL_INTERVAL_MS } from "./constants.ts";
import { decode } from "./response.ts";
import type { ExecSession } from "./session.ts";
import type { ToolUpdate, UnifiedExecDetails } from "./tool-types.ts";

function streamingDetails(session: ExecSession, output: string): UnifiedExecDetails {
  return {
    session_id: session.id,
    pid: session.pid,
    total_bytes: session.totalBytesSeen,
    running: !session.hasExited,
    tty: session.tty,
    command: session.displayCommand,
    cwd: session.cwd,
    log_path: session.logPath,
    output,
  };
}

export function emitSessionUpdate(session: ExecSession, onUpdate: ToolUpdate): void {
  const output = decode(session.snapshotStreamTail());
  onUpdate({
    content: [{ type: "text", text: output }],
    details: streamingDetails(session, output),
  });
}

export function startStreaming(
  session: ExecSession,
  onUpdate: ToolUpdate | undefined,
  deadlineMs: number,
  externalAbort: AbortSignal | undefined,
): { stop: () => void } {
  if (!onUpdate) return { stop: () => undefined };
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = (): void => {
    if (stopped) return;
    try {
      emitSessionUpdate(session, onUpdate);
    } catch {
      // Ignore transient rendering failures.
    }
    if (!stopped && Date.now() < deadlineMs && !externalAbort?.aborted) {
      timer = setTimeout(tick, OUTPUT_POLL_INTERVAL_MS);
    }
  };
  timer = setTimeout(tick, OUTPUT_POLL_INTERVAL_MS);
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
