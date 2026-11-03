import type { GateState } from "./gate-state.ts";

/**
 * Tools that only read local state. They pass without a dialog so the gate does not interrupt
 * inspection work. The list covers local reads only: a tool that reaches the network is gated,
 * because a call that leaves the machine can carry private data out.
 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "todo",
  "update_plan",
  "list_sessions",
]);

/** Polls and empty writes to a live session are reads; input written to it is not. */
export const WRITE_STDIN_TOOL = "write_stdin";

/** The declared hints of a tool, as Pi reports them in `getAllTools()`. */
export type ToolHints = {
  readOnlyHint?: boolean | undefined;
  destructiveHint?: boolean | undefined;
};

export type GateDecision =
  { action: "pass" } | { action: "ask" } | { action: "block"; reason: string };

export type GateDecisionInput = {
  state: GateState;
  toolName: string;
  input: Record<string, unknown>;
  hints: ToolHints | undefined;
  hasUI: boolean;
};

export const NO_UI_REASON = [
  "The approval gate is on and this run has no interactive UI, so Pi did not approve this call.",
  "It did not run. Start Pi with PI_PERMISSION_GATE=off when a run needs no approval.",
].join(" ");

/**
 * Decide what happens to one tool call. Pure: the caller owns the state, the dialog, and the
 * blocking reason.
 */
export function decide(input: GateDecisionInput): GateDecision {
  if (!input.state.enabled) return { action: "pass" };
  if (isReadOnly(input)) return { action: "pass" };
  if (input.hasUI) return { action: "ask" };
  return { action: "block", reason: NO_UI_REASON };
}

/**
 * A declared hint wins over the name list, so a tool that declares `readOnlyHint: false` or
 * `destructiveHint: true` is gated even when its name matches a local read.
 */
function isReadOnly(input: GateDecisionInput): boolean {
  const hints = input.hints;
  if (hints?.destructiveHint === true) return false;
  if (hints?.readOnlyHint !== undefined) return hints.readOnlyHint;
  if (READ_ONLY_TOOLS.has(input.toolName)) return true;
  return input.toolName === WRITE_STDIN_TOOL && !sendsInput(input.input);
}

/** Non-empty text or base64 input counts as a write to the session. */
export function sendsInput(input: Record<string, unknown>): boolean {
  return isNonEmptyString(input["chars"]) || isNonEmptyString(input["chars_b64"]);
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value !== "";
}
