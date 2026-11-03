import type { GateState } from "./gate-state.ts";

/**
 * Built-in and extension tools that only read state. They pass without a prompt so the gate does
 * not interrupt inspection work. Tools that declare `readOnlyHint` pass too.
 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "todo",
  "update_plan",
  "list_sessions",
  "web_search",
  "source_check",
  "fetch_content",
  "get_search_content",
]);

/** Polls and empty writes to a live session are reads; input written to it is not. */
export const WRITE_STDIN_TOOL = "write_stdin";

export type GateDecision =
  { action: "pass" } | { action: "ask" } | { action: "block"; reason: string };

export type GateDecisionInput = {
  state: GateState;
  toolName: string;
  input: Record<string, unknown>;
  readOnlyHint: boolean | undefined;
  parentToolCallId: string | undefined;
  hasUI: boolean;
};

export const NO_UI_REASON = [
  "The approval gate is on and this run has no interactive UI, so Pi did not approve this call.",
  "It did not run. Start Pi with PI_PERMISSION_GATE=off when a run needs no approval.",
].join(" ");

/**
 * Decide what happens to one tool call. Pure: the caller owns the state and the prompt.
 */
export function decide(input: GateDecisionInput): GateDecision {
  if (!input.state.enabled) return { action: "pass" };
  if (isCoveredByApproval(input)) return { action: "pass" };
  if (isReadOnly(input)) return { action: "pass" };
  if (input.hasUI) return { action: "ask" };
  return { action: "block", reason: NO_UI_REASON };
}

function isCoveredByApproval(input: GateDecisionInput): boolean {
  if (input.state.allowedTools.has(input.toolName)) return true;
  const parent = input.parentToolCallId;
  return parent !== undefined && input.state.approvedCalls.has(parent);
}

function isReadOnly(input: GateDecisionInput): boolean {
  if (input.readOnlyHint === true) return true;
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
