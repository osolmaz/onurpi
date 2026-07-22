import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";

import {
  configurationFromBranch,
  DEFAULT_TURN_FOLD_CONFIGURATION,
  TURN_FOLD_CONFIG_ENTRY,
  type TurnFoldConfiguration,
} from "./configuration.ts";
import {
  closeCompactionRegistry,
  type EphemeralCompactionAssociation,
  type EphemeralCompactionRegistry,
  processCompactionRegistry,
} from "./ephemeral-compactions.ts";
import { installRenderPatches } from "./render-patches.ts";
import {
  installTranscriptWindowAdapter,
  type TranscriptWindowAdapter,
} from "./transcript-window-adapter.ts";
import { isTurnFoldMode, type TurnFoldMode } from "./mode.ts";
import {
  compactionWindowCount,
  formatTranscriptWindowValue,
  resolveWindowArgument,
} from "./transcript-windows.ts";
import { TurnFoldState } from "./turn-state.ts";

const TOGGLE_SHORTCUT = "ctrl+shift+o";
const WINDOW_ARGUMENTS = ["1", "3", "+1", "-1", "all", "reset"] as const;

const MODE_LABELS: readonly { label: string; mode: TurnFoldMode }[] = [
  { label: "Compact transcript", mode: "compact" },
  { label: "Expanded transcript", mode: "expanded" },
];

type BranchEntries = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>;

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

function sessionRegistryKey(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionFile() ?? `session:${ctx.sessionManager.getSessionId()}`;
}

function compactionAssociationsForBranch(
  branch: BranchEntries,
  ctx: ExtensionContext,
  registry: EphemeralCompactionRegistry,
): ReadonlyMap<string, EphemeralCompactionAssociation> {
  const compactionIds = new Set(
    branch.filter((entry) => entry.type === "compaction").map((entry) => entry.id),
  );
  return new Map(
    [...registry.associationsFor(sessionRegistryKey(ctx))].filter(([entryId]) =>
      compactionIds.has(entryId),
    ),
  );
}

function turnEntryIds(branch: BranchEntries, compactionEntryId: string): readonly string[] {
  const compactionIndex = branch.findIndex((entry) => entry.id === compactionEntryId);
  if (compactionIndex < 0) return [];
  for (let index = compactionIndex - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type === "message" && entry.message.role === "user") {
      return branch.slice(index, compactionIndex).map((turnEntry) => turnEntry.id);
    }
  }
  return [];
}

function loadVisibleHistory(
  state: TurnFoldState,
  ctx: ExtensionContext,
  branch: BranchEntries,
  registry: EphemeralCompactionRegistry,
): void {
  state.loadHistory(
    ctx.sessionManager.buildContextEntries(),
    compactionAssociationsForBranch(branch, ctx, registry),
  );
}

async function chooseMode(
  state: TurnFoldState,
  ctx: ExtensionContext,
  setMode: (mode: TurnFoldMode) => void,
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
  if (selectedMode && selectedMode !== state.getMode()) setMode(selectedMode);
}

function windowCompletions(prefix: string): { label: string; value: string }[] {
  const normalized = prefix.trimStart().toLowerCase();
  if (!normalized.startsWith("windows")) return [];
  const argumentPrefix = normalized.slice("windows".length).trimStart();
  return WINDOW_ARGUMENTS.filter((value) => value.startsWith(argumentPrefix)).map((value) => ({
    label: value,
    value: `windows ${value}`,
  }));
}

function windowArgument(command: string): string | undefined {
  const match = /^windows(?:\s+(.*))?$/u.exec(command);
  return match?.[1]?.trim();
}

async function confirmAllWindows(
  ctx: ExtensionCommandContext,
  entries: BranchEntries,
): Promise<boolean> {
  if (!ctx.hasUI) {
    ctx.ui.notify("Full transcript replay requires interactive confirmation.", "warning");
    return false;
  }
  return ctx.ui.confirm(
    "Load full transcript?",
    `This will render ${String(entries.length)} active-branch entries and may slow editor input.`,
  );
}

type ApplyConfiguration = (configuration: TurnFoldConfiguration, persist: boolean) => void;
type GetConfiguration = () => TurnFoldConfiguration;

function argumentCompletions(prefix: string): { label: string; value: string }[] {
  const windows = windowCompletions(prefix);
  if (windows.length > 0) return windows;
  return ["compact", "expanded", "status", "toggle", "windows"]
    .filter((value) => value.startsWith(prefix.trim().toLowerCase()))
    .map((value) => ({ label: value, value }));
}

async function applyWindowArgument(
  argument: string,
  ctx: ExtensionCommandContext,
  configuration: TurnFoldConfiguration,
  applyConfiguration: ApplyConfiguration,
): Promise<void> {
  const branch = ctx.sessionManager.getBranch();
  const resolved = resolveWindowArgument(
    argument,
    configuration.windows,
    compactionWindowCount(branch),
  );
  if (!resolved.ok) {
    ctx.ui.notify(resolved.error, "warning");
    return;
  }
  if (resolved.value === configuration.windows) {
    ctx.ui.notify(
      `Compaction windows already set to ${formatTranscriptWindowValue(resolved.value)}.`,
      "info",
    );
    return;
  }
  if (resolved.value === "all" && !(await confirmAllWindows(ctx, branch))) return;
  applyConfiguration({ ...configuration, windows: resolved.value }, true);
  await ctx.reload();
}

async function handleCommand(
  args: string,
  ctx: ExtensionCommandContext,
  state: TurnFoldState,
  getConfiguration: GetConfiguration,
  applyConfiguration: ApplyConfiguration,
): Promise<void> {
  const command = args.trim().toLowerCase();
  const configuration = getConfiguration();
  const setMode = (mode: TurnFoldMode): void => {
    applyConfiguration({ ...configuration, mode }, true);
  };
  if (!command) return chooseMode(state, ctx, setMode);
  if (command === "status") {
    ctx.ui.notify(
      `Turn fold: ${state.getMode()}, windows ${formatTranscriptWindowValue(configuration.windows)}`,
      "info",
    );
    return;
  }
  if (command === "toggle") {
    setMode(state.toggleExpanded());
    return;
  }
  if (isTurnFoldMode(command)) {
    setMode(command);
    return;
  }
  if (command === "windows") {
    ctx.ui.notify(
      `Loaded compaction windows: ${formatTranscriptWindowValue(configuration.windows)}`,
      "info",
    );
    return;
  }
  const argument = windowArgument(command);
  if (argument !== undefined) {
    await applyWindowArgument(argument, ctx, configuration, applyConfiguration);
    return;
  }
  ctx.ui.notify(
    "Usage: /turn-fold [compact|expanded|status|toggle|windows <N|+N|-N|all|reset>]",
    "warning",
  );
}

function registerControls(
  pi: ExtensionAPI,
  state: TurnFoldState,
  getConfiguration: GetConfiguration,
  applyConfiguration: ApplyConfiguration,
): void {
  pi.registerCommand("turn-fold", {
    description: "Control transcript folding and loaded compaction windows.",
    getArgumentCompletions: argumentCompletions,
    handler: (args, ctx) => handleCommand(args, ctx, state, getConfiguration, applyConfiguration),
  });
  pi.registerShortcut(TOGGLE_SHORTCUT, {
    description: "Toggle compact and expanded transcript rendering",
    handler: () => {
      const configuration = getConfiguration();
      applyConfiguration({ ...configuration, mode: state.toggleExpanded() }, true);
    },
  });
}

export default function turnFold(pi: ExtensionAPI): void {
  const state = new TurnFoldState();
  const compactionRegistry = processCompactionRegistry();
  let adapter: TranscriptWindowAdapter | undefined;
  let configuration = DEFAULT_TURN_FOLD_CONFIGURATION;
  let currentTheme: Theme | undefined;
  const restorePatches = installRenderPatches(state, () => currentTheme);

  const applyConfiguration = (next: TurnFoldConfiguration, persist: boolean): void => {
    configuration = next;
    adapter?.setValue(next.windows);
    if (state.getMode() !== next.mode) state.setMode(next.mode);
    if (persist) pi.appendEntry(TURN_FOLD_CONFIG_ENTRY, next);
  };
  registerControls(pi, state, () => configuration, applyConfiguration);

  pi.on("session_start", (_event, ctx) => {
    currentTheme = ctx.ui.theme;
    const branch = ctx.sessionManager.getBranch();
    configuration = configurationFromBranch(branch);
    adapter = installTranscriptWindowAdapter(ctx.sessionManager, configuration.windows);
    applyConfiguration(configuration, false);
    loadVisibleHistory(state, ctx, branch, compactionRegistry);
  });

  pi.on("session_compact", (event, ctx) => {
    currentTheme = ctx.ui.theme;
    adapter?.markPendingCompaction(event.compactionEntry.id);
    const branch = ctx.sessionManager.getBranch();
    const association = state.registerCompaction(
      event.compactionEntry,
      event.reason,
      turnEntryIds(branch, event.compactionEntry.id),
    );
    if (association) compactionRegistry.remember(sessionRegistryKey(ctx), association);
    state.deferHistoryReload(() => ctx.sessionManager.buildContextEntries());
  });

  pi.on("session_tree", (_event, ctx) => {
    currentTheme = ctx.ui.theme;
    const branch = ctx.sessionManager.getBranch();
    state.replaceCompactionAssociations(
      compactionAssociationsForBranch(branch, ctx, compactionRegistry),
    );
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

  pi.on("session_shutdown", (event) => {
    closeCompactionRegistry(compactionRegistry, event.reason);
    restorePatches();
  });
}
