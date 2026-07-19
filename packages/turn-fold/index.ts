import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

import { installRenderPatches } from "./render-patches.ts";
import { isTurnFoldMode, type TurnFoldMode } from "./mode.ts";
import { TurnFoldState } from "./turn-state.ts";

const CONFIG_ENTRY_TYPE = "onurpi-turn-fold-config";
const TOGGLE_SHORTCUT = "ctrl+shift+o";

const MODE_LABELS: readonly { label: string; mode: TurnFoldMode }[] = [
  { label: "Live then fold", mode: "live" },
  { label: "Final response only", mode: "final-only" },
  { label: "Expanded transcript", mode: "expanded" },
];

function modeFromBranch(ctx: ExtensionContext): TurnFoldMode {
  let mode: TurnFoldMode = "live";
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

function applyMode(
  pi: ExtensionAPI,
  state: TurnFoldState,
  mode: TurnFoldMode,
  persist: boolean,
): void {
  state.setMode(mode);
  if (persist) pi.appendEntry(CONFIG_ENTRY_TYPE, { mode });
}

async function chooseMode(
  pi: ExtensionAPI,
  state: TurnFoldState,
  ctx: ExtensionContext,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("Use /turn-fold final-only|live|expanded in this mode.", "warning");
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
    description: "Choose final-only, live, or expanded turn rendering.",
    getArgumentCompletions(prefix) {
      return ["final-only", "live", "expanded", "status", "toggle"]
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
      ctx.ui.notify("Usage: /turn-fold [final-only|live|expanded|status|toggle]", "warning");
    },
  });

  pi.registerShortcut(TOGGLE_SHORTCUT, {
    description: "Toggle folded and expanded turn rendering",
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
    state.loadHistory(ctx.sessionManager.getBranch());
    applyMode(pi, state, modeFromBranch(ctx), false);
  });

  pi.on("agent_start", (_event, ctx) => {
    currentTheme = ctx.ui.theme;
    state.ensureActive();
  });

  pi.on("message_start", (event, ctx) => {
    currentTheme = ctx.ui.theme;
    const role = messageRole(event.message);
    if (role === "user") state.ensureActive(messageTimestamp(event.message));
    if (role === "assistant") state.registerAssistantMessage(event.message);
  });

  pi.on("message_update", (event, ctx) => {
    currentTheme = ctx.ui.theme;
    state.registerAssistantMessage(event.message);
  });

  pi.on("message_end", (event, ctx) => {
    currentTheme = ctx.ui.theme;
    if (messageRole(event.message) === "assistant") {
      state.registerAssistantMessage(event.message);
    }
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
