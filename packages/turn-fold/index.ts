import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

import { COMPACTION_METADATA_ENTRY_TYPE } from "./compaction-metadata.ts";
import { installRenderPatches } from "./render-patches.ts";
import { isTurnFoldMode, type TurnFoldMode } from "./mode.ts";
import { TurnFoldState } from "./turn-state.ts";

const CONFIG_ENTRY_TYPE = "onurpi-turn-fold-config";
const TOGGLE_SHORTCUT = "ctrl+shift+o";

const MODE_LABELS: readonly { label: string; mode: TurnFoldMode }[] = [
  { label: "Compact transcript", mode: "compact" },
  { label: "Expanded transcript", mode: "expanded" },
];

function modeFromBranch(ctx: ExtensionContext): TurnFoldMode {
  let mode: TurnFoldMode = "compact";
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== CONFIG_ENTRY_TYPE) continue;
    const data: unknown = entry.data;
    if (typeof data !== "object" || data === null) continue;
    const storedMode: unknown = Reflect.get(data, "mode");
    if (isTurnFoldMode(storedMode)) mode = storedMode;
  }
  return mode;
}

function messageTimestamp(message: unknown): number | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const timestamp: unknown = Reflect.get(message, "timestamp");
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : undefined;
}

function messageRole(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const role: unknown = Reflect.get(message, "role");
  return typeof role === "string" ? role : undefined;
}

function messageStopReason(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const stopReason: unknown = Reflect.get(message, "stopReason");
  return typeof stopReason === "string" ? stopReason : undefined;
}

function loadVisibleHistory(state: TurnFoldState, ctx: ExtensionContext): void {
  state.loadHistory(ctx.sessionManager.buildContextEntries());
}

function applyMode(
  pi: ExtensionAPI,
  state: TurnFoldState,
  mode: TurnFoldMode,
  persist: boolean,
): void {
  if (state.getMode() !== mode) state.setMode(mode);
  if (persist) pi.appendEntry(CONFIG_ENTRY_TYPE, { mode });
}

async function chooseMode(
  pi: ExtensionAPI,
  state: TurnFoldState,
  ctx: ExtensionContext,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("Use /turn-fold compact|expanded in this mode.", "warning");
    return;
  }
  const selection = await ctx.ui.select(
    "Turn fold mode",
    MODE_LABELS.map(({ label }) => label),
  );
  const selectedMode = MODE_LABELS.find(({ label }) => label === selection)?.mode;
  if (selectedMode) applyMode(pi, state, selectedMode, true);
}

function registerCommands(pi: ExtensionAPI, state: TurnFoldState): void {
  pi.registerCommand("turn-fold", {
    description: "Choose compact or expanded transcript rendering.",
    getArgumentCompletions(prefix) {
      return ["compact", "expanded", "status", "toggle"]
        .filter((value) => value.startsWith(prefix.trim()))
        .map((value) => ({ label: value, value }));
    },
    handler: async (args, ctx) => {
      const command = args.trim().toLowerCase();
      if (!command) {
        await chooseMode(pi, state, ctx);
        return;
      }
      if (command === "status") {
        ctx.ui.notify(`Turn fold mode: ${state.getMode()}`, "info");
        return;
      }
      if (command === "toggle") {
        applyMode(pi, state, state.toggleExpanded(), true);
        return;
      }
      if (isTurnFoldMode(command)) {
        applyMode(pi, state, command, true);
        return;
      }
      ctx.ui.notify("Usage: /turn-fold [compact|expanded|status|toggle]", "warning");
    },
  });

  pi.registerShortcut(TOGGLE_SHORTCUT, {
    description: "Toggle compact and expanded transcript rendering",
    handler: () => {
      applyMode(pi, state, state.toggleExpanded(), true);
    },
  });
}

export default function turnFold(pi: ExtensionAPI): void {
  const state = new TurnFoldState();
  let currentTheme: Theme | undefined;
  const restorePatches = installRenderPatches(state, () => currentTheme);
  registerCommands(pi, state);

  pi.on("session_start", (_event, ctx) => {
    currentTheme = ctx.ui.theme;
    applyMode(pi, state, modeFromBranch(ctx), false);
    loadVisibleHistory(state, ctx);
  });

  pi.on("session_compact", (event, ctx) => {
    currentTheme = ctx.ui.theme;
    const attachedToTurn = state.registerCompaction(event.compactionEntry, event.reason);
    pi.appendEntry(COMPACTION_METADATA_ENTRY_TYPE, {
      attachedToTurn,
      compactionEntryId: event.compactionEntry.id,
      reason: event.reason,
    });
    state.deferHistoryReload(() => ctx.sessionManager.buildContextEntries());
  });

  pi.on("session_tree", (_event, ctx) => {
    currentTheme = ctx.ui.theme;
    state.deferHistoryReload(() => ctx.sessionManager.buildContextEntries());
  });

  pi.on("agent_start", (_event, ctx) => {
    currentTheme = ctx.ui.theme;
    state.ensureActive();
  });

  pi.on("message_start", (event, ctx) => {
    currentTheme = ctx.ui.theme;
    const role = messageRole(event.message);
    if (role === "user") state.startUserTurn(messageTimestamp(event.message));
    if (role === "assistant") state.beginAssistantMessage(event.message);
  });

  pi.on("message_update", (event, ctx) => {
    currentTheme = ctx.ui.theme;
    state.registerAssistantMessage(event.message);
  });

  pi.on("message_end", (event, ctx) => {
    currentTheme = ctx.ui.theme;
    if (messageRole(event.message) !== "assistant") return;
    state.endAssistantMessage(event.message);
    if (messageStopReason(event.message) === "aborted") state.abortActive();
  });

  pi.on("tool_execution_start", (event, ctx) => {
    currentTheme = ctx.ui.theme;
    state.registerToolStart(event.toolCallId);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    currentTheme = ctx.ui.theme;
    state.registerToolEnd(event.toolCallId, event.isError);
  });

  pi.on("agent_settled", (_event, ctx) => {
    currentTheme = ctx.ui.theme;
    state.settleActive();
  });

  pi.on("session_shutdown", () => {
    restorePatches();
  });
}
