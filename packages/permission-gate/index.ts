import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

import { GATE_USAGE, gateStatusText, parseGateCommand } from "./src/command.ts";
import {
  allowToolForSession,
  approveCall,
  createGateState,
  resetSession,
  setGateEnabled,
  toggleGate,
  type GateState,
} from "./src/gate-state.ts";
import { decide } from "./src/policy.ts";
import { describeCall } from "./src/summary.ts";

/**
 * Approval gate for Pi. It asks before a tool call that is not read-only, keeps the answer in
 * process memory, and reports state only through `ctx.ui.notify`. It never writes a status line,
 * a widget, or a session entry.
 */

export const COMMAND_NAME = "gate";
export const ENV_VAR = "PI_PERMISSION_GATE";

const ALLOW_ONCE = "Allow once";
const DENY = "Deny";
const OFF_VALUES: ReadonlySet<string> = new Set(["off", "false", "0", "no"]);

export type Approval = { allowed: boolean; remember: boolean };

/** The gate is on unless the environment turns it off for this process. */
export function initialGateEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = (env[ENV_VAR] ?? "").trim().toLowerCase();
  return !OFF_VALUES.has(value);
}

export default function permissionGate(pi: ExtensionAPI): void {
  const state = createGateState(initialGateEnabled(process.env));

  pi.on("tool_call", (event, ctx) => handleToolCall(pi, state, event, ctx));

  pi.on("session_start", () => {
    resetSession(state);
  });
  pi.on("session_before_switch", () => {
    resetSession(state);
  });
  pi.on("session_before_fork", () => {
    resetSession(state);
  });

  pi.registerCommand(COMMAND_NAME, {
    description: "Toggle the approval gate (on, off, status)",
    handler: (args, ctx) => {
      runCommand(state, args, ctx);
      return Promise.resolve();
    },
  });
}

async function handleToolCall(
  pi: ExtensionAPI,
  state: GateState,
  event: ToolCallEvent,
  ctx: ExtensionContext,
): Promise<ToolCallEventResult | undefined> {
  const toolName = event.toolName;
  const input = event.input as Record<string, unknown>;
  const decision = decide({
    state,
    toolName,
    input,
    readOnlyHint: readOnlyHintOf(pi, toolName),
    parentToolCallId: event.parentToolCallId,
    hasUI: ctx.hasUI,
  });

  if (decision.action === "block") return { block: true, reason: decision.reason };
  if (decision.action === "pass") return undefined;

  const approval = await askApproval(ctx, toolName, describeCall(toolName, input));
  if (!approval.allowed) {
    return { block: true, reason: `${toolName} was not approved, so it did not run.` };
  }
  if (approval.remember) allowToolForSession(state, toolName);
  approveCall(state, event.toolCallId);
  return undefined;
}

async function askApproval(
  ctx: ExtensionContext,
  toolName: string,
  summary: string,
): Promise<Approval> {
  const remember = `Always allow ${toolName} in this session`;
  const choice = await ctx.ui.select(
    `Allow this call?

${summary}`,
    [ALLOW_ONCE, remember, DENY],
  );
  return { allowed: choice === ALLOW_ONCE || choice === remember, remember: choice === remember };
}

function readOnlyHintOf(pi: ExtensionAPI, toolName: string): boolean | undefined {
  const tool = pi.getAllTools().find((candidate) => candidate.name === toolName);
  return tool?.annotations?.readOnlyHint;
}

function runCommand(state: GateState, args: string, ctx: ExtensionCommandContext): void {
  const action = parseGateCommand(args);
  if (action === "invalid") {
    ctx.ui.notify(GATE_USAGE, "error");
    return;
  }
  if (action === "on") setGateEnabled(state, true);
  if (action === "off") setGateEnabled(state, false);
  if (action === "toggle") toggleGate(state);
  ctx.ui.notify(gateStatusText(state), "info");
}
