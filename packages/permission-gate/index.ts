import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolAnnotations,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

import { createApprovalComponent } from "./src/approval.ts";
import { GATE_USAGE, gateStatusText, parseGateCommand } from "./src/command.ts";
import { createDialogQueue, type DialogQueue } from "./src/dialog-queue.ts";
import { createGateState, setGateEnabled, toggleGate, type GateState } from "./src/gate-state.ts";
import { decide, type ToolHints } from "./src/policy.ts";
import { describeCall } from "./src/summary.ts";

/**
 * Approval gate for Pi. It is off at startup, asks before a tool call that is not a local read when
 * it is on, keeps only that switch in process memory, and reports the switch through
 * `ctx.ui.notify`. It never writes a status line, a widget, a footer, a header, or a session entry.
 */

export const COMMAND_NAME = "gate";
export const ENV_VAR = "PI_PERMISSION_GATE";

const DENY = "Deny";
const ALLOW_ONCE = "Allow once";
const ON_VALUES: ReadonlySet<string> = new Set(["on", "true", "1", "yes"]);

/** The gate is off unless the environment turns it on for this process. */
export function initialGateEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = (env[ENV_VAR] ?? "").trim().toLowerCase();
  return ON_VALUES.has(value);
}

/** In a selector, Deny comes first, so a stray Enter denies instead of allowing. */
export const APPROVAL_OPTIONS: readonly string[] = [DENY, ALLOW_ONCE];

export default function permissionGate(pi: ExtensionAPI): void {
  const state = createGateState(initialGateEnabled(process.env));
  const dialogs = createDialogQueue();

  pi.on("tool_call", (event, ctx) => handleToolCall(pi, dialogs, state, event, ctx));

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
  dialogs: DialogQueue,
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
    hints: hintsOf(pi, toolName),
    hasUI: ctx.hasUI,
  });

  if (decision.action === "block") return { block: true, reason: decision.reason };
  if (decision.action === "pass") return undefined;

  const summary = describeCall(toolName, input);
  const approved = await dialogs.run(() => askApproval(ctx, summary));
  if (!approved) {
    return { block: true, reason: `${toolName} was not approved, so it did not run.` };
  }
  return undefined;
}

/**
 * Keep the whole call description in front of the user, and accept only the letter keys, so a
 * message typed ahead cannot approve a call.
 */
async function askApproval(ctx: ExtensionContext, summary: string): Promise<boolean> {
  if (ctx.mode !== "tui") return askWithSelector(ctx, summary);

  const openedAt = Date.now();
  return ctx.ui.custom<boolean>((_tui, theme, keybindings, done) =>
    createApprovalComponent({
      summary,
      text: {
        title: (text) => theme.fg("accent", text),
        body: (text) => text,
        hint: (text) => theme.fg("dim", text),
      },
      matchesCancel: (data) => keybindings.matches(data, "tui.select.cancel"),
      now: Date.now,
      openedAt,
      done,
    }),
  );
}

/** RPC and other dialog-capable modes have no custom component, so they answer by label. */
async function askWithSelector(ctx: ExtensionContext, summary: string): Promise<boolean> {
  const signal = ctx.signal;
  const options = signal === undefined ? undefined : { signal };
  const choice = await ctx.ui.select(
    `Allow this call?

${summary}`,
    [...APPROVAL_OPTIONS],
    options,
  );
  return choice === ALLOW_ONCE;
}

function hintsOf(pi: ExtensionAPI, toolName: string): ToolHints | undefined {
  const tool = pi.getAllTools().find((candidate) => candidate.name === toolName);
  const annotations: ToolAnnotations | undefined = tool?.annotations;
  if (annotations === undefined) return undefined;
  return {
    readOnlyHint: annotations.readOnlyHint,
    destructiveHint: annotations.destructiveHint,
    openWorldHint: annotations.openWorldHint,
  };
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
