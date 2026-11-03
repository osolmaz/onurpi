import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolAnnotations,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

import { createApprovalComponent } from "./src/approval.ts";
import { USAGE, statusText, parseCommand } from "./src/command.ts";
import { createDialogQueue, type DialogQueue } from "./src/dialog-queue.ts";
import { createPermissionState, setEnabled, toggle, type PermissionState } from "./src/state.ts";
import { decide, type ToolHints } from "./src/policy.ts";
import { describeCall } from "./src/summary.ts";

/**
 * Permissions for Pi. They are off at startup, ask before a tool call that is not a local read when
 * they are on, keep only that switch in process memory, and report the switch through
 * `ctx.ui.notify`. Nothing here writes a status line, a widget, a footer, a header, or a session
 * entry.
 */

export const COMMAND_NAME = "permissions";
export const ENV_VAR = "PI_PERMISSIONS";

const DENY = "Deny";
const ALLOW_ONCE = "Allow once";
const ON_VALUES: ReadonlySet<string> = new Set(["on", "true", "1", "yes"]);

/** Permissions are off unless the environment turns them on for this process. */
export function initialEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = (env[ENV_VAR] ?? "").trim().toLowerCase();
  return ON_VALUES.has(value);
}

/** In a selector, Deny comes first, so a stray Enter denies instead of allowing. */
export const APPROVAL_OPTIONS: readonly string[] = [DENY, ALLOW_ONCE];

export default function permissions(pi: ExtensionAPI): void {
  const state = createPermissionState(initialEnabled(process.env));
  const dialogs = createDialogQueue();

  pi.on("tool_call", (event, ctx) => handleToolCall(pi, dialogs, state, event, ctx));

  pi.registerCommand(COMMAND_NAME, {
    description: "Turn the check on or off, or report it (on, off, status)",
    handler: (args, ctx) => {
      runCommand(state, args, ctx);
      return Promise.resolve();
    },
  });
}

async function handleToolCall(
  pi: ExtensionAPI,
  dialogs: DialogQueue,
  state: PermissionState,
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
 * Keep the whole call description in front of the user. Enter and y allow, n and escape deny, and a
 * quiet moment is required before an allow, so a message typed ahead cannot approve a call.
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

function runCommand(state: PermissionState, args: string, ctx: ExtensionCommandContext): void {
  const action = parseCommand(args);
  if (action === "invalid") {
    ctx.ui.notify(USAGE, "error");
    return;
  }
  if (action === "on") setEnabled(state, true);
  if (action === "off") setEnabled(state, false);
  if (action === "toggle") toggle(state);
  ctx.ui.notify(statusText(state), "info");
}
