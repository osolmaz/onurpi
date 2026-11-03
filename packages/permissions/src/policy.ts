import type { PermissionState } from "./state.ts";

/**
 * Tools that only read local state. They pass without a dialog, so a permission check does not
 * interrupt inspection work. The list covers local reads only: a tool that reaches the network is
 * checked too, because a call that leaves the machine can carry private data out.
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
  openWorldHint?: boolean | undefined;
};

export type Decision = { action: "pass" } | { action: "ask" } | { action: "block"; reason: string };

export type DecisionInput = {
  state: PermissionState;
  toolName: string;
  input: Record<string, unknown>;
  hints: ToolHints | undefined;
  hasUI: boolean;
};

export const NO_UI_REASON = [
  "Permissions are on and this run has no interactive UI, so Pi did not approve this call.",
  "It did not run. Turn them off with /permissions off, or start Pi without PI_PERMISSIONS=on.",
].join(" ");

/**
 * Decide what happens to one tool call. Pure: the caller owns the state, the dialog, and the
 * blocking reason.
 */
export function decide(input: DecisionInput): Decision {
  if (!input.state.enabled) return { action: "pass" };
  if (isReadOnly(input)) return { action: "pass" };
  if (input.hasUI) return { action: "ask" };
  return { action: "block", reason: NO_UI_REASON };
}

/**
 * A declared hint wins over the name list, so a tool that declares `readOnlyHint: false` or
 * `destructiveHint: true` is checked even when its name matches a local read. Pi's docs say a missing
 * `openWorldHint` means the tool may reach the network, so only `openWorldHint: false` may pass.
 */
function isReadOnly(input: DecisionInput): boolean {
  const hints = input.hints;
  if (hints?.destructiveHint === true) return false;
  if (hints?.readOnlyHint !== undefined) {
    return hints.readOnlyHint && hints.openWorldHint === false;
  }
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
