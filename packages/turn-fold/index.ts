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
import { showHistoryViewer } from "./history-viewer.ts";
import { isTurnFoldMode, type TurnFoldMode } from "./mode.ts";
import { installTurnFoldShortcutEditor, ToggleShortcutController } from "./shortcut-editor.ts";
import { nearestRunStartIndex, RunBoundaryRecorder } from "./run-boundary.ts";
import {
  compactionWindowCount,
  formatTranscriptWindowValue,
  resolveWindowArgument,
  selectTranscriptEntries,
} from "./transcript-windows.ts";
import { TurnFoldState } from "./turn-state.ts";
import { projectTranscriptEntries } from "./transcript-projection.ts";

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

function registerEndedAssistant(state: TurnFoldState, message: unknown): void {
  if (messageRole(message) !== "assistant") return;
  state.endAssistantMessage(message);
  if (messageStopReason(message) === "aborted") state.abortActive();
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
  const startIndex = nearestRunStartIndex(branch, compactionIndex);
  return startIndex === undefined
    ? []
    : branch.slice(startIndex, compactionIndex).map((turnEntry) => turnEntry.id);
}

type ApplyConfiguration = (configuration: TurnFoldConfiguration, persist: boolean) => void;
type GetConfiguration = () => TurnFoldConfiguration;

function canRebuildTranscript(ctx: ExtensionCommandContext): boolean {
  if (ctx.mode !== "tui" || ctx.sessionManager.getSessionFile()) return true;
  ctx.ui.notify("Turn Fold replay changes require a persisted session in TUI mode.", "warning");
  return false;
}

async function reloadTranscript(ctx: ExtensionCommandContext): Promise<void> {
  if (ctx.mode !== "tui") {
    await ctx.reload();
    return;
  }
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) return;
  const result = await ctx.switchSession(sessionFile);
  if (result.cancelled) {
    ctx.ui.notify("Turn Fold changed, but transcript replay was cancelled.", "warning");
  }
}

async function applyMode(
  mode: TurnFoldMode,
  ctx: ExtensionCommandContext,
  configuration: TurnFoldConfiguration,
  applyConfiguration: ApplyConfiguration,
): Promise<void> {
  if (mode === configuration.mode) {
    if (mode === "compact") {
      await ctx.waitForIdle();
      applyConfiguration(configuration, false);
      ctx.ui.notify("Turn Fold: compact", "info");
    }
    return;
  }
  await ctx.waitForIdle();
  if (mode === "expanded" && !canRebuildTranscript(ctx)) return;
  applyConfiguration({ ...configuration, mode }, true);
  if (mode === "compact") {
    ctx.ui.notify("Turn Fold: compact", "info");
    return;
  }
  await reloadTranscript(ctx);
}

async function chooseMode(
  ctx: ExtensionCommandContext,
  configuration: TurnFoldConfiguration,
  applyConfiguration: ApplyConfiguration,
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
  if (selectedMode) await applyMode(selectedMode, ctx, configuration, applyConfiguration);
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

function argumentCompletions(prefix: string): { label: string; value: string }[] {
  const windows = windowCompletions(prefix);
  if (windows.length > 0) return windows;
  return ["compact", "expanded", "history", "status", "toggle", "windows"]
    .filter((value) => value.startsWith(prefix.trim().toLowerCase()))
    .map((value) => ({ label: value, value }));
}

async function applyWindowArgument(
  argument: string,
  ctx: ExtensionCommandContext,
  configuration: TurnFoldConfiguration,
  applyConfiguration: ApplyConfiguration,
): Promise<void> {
  await ctx.waitForIdle();
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
  await ctx.waitForIdle();
  if (!canRebuildTranscript(ctx)) return;
  applyConfiguration({ ...configuration, windows: resolved.value }, true);
  await reloadTranscript(ctx);
}

async function handleInformationCommand(
  command: string,
  ctx: ExtensionCommandContext,
  state: TurnFoldState,
  configuration: TurnFoldConfiguration,
  getSourceEntries: () => BranchEntries,
): Promise<boolean> {
  if (command === "history") {
    await showHistoryViewer(ctx, getSourceEntries());
    return true;
  }
  if (command === "status") {
    ctx.ui.notify(
      `Turn fold: ${state.getMode()}, windows ${formatTranscriptWindowValue(configuration.windows)}`,
      "info",
    );
    return true;
  }
  if (command === "windows") {
    ctx.ui.notify(
      `Loaded compaction windows: ${formatTranscriptWindowValue(configuration.windows)}`,
      "info",
    );
    return true;
  }
  return false;
}

async function handleCommand(
  args: string,
  ctx: ExtensionCommandContext,
  state: TurnFoldState,
  getConfiguration: GetConfiguration,
  applyConfiguration: ApplyConfiguration,
  getSourceEntries: () => BranchEntries,
): Promise<void> {
  const command = args.trim().toLowerCase();
  const configuration = getConfiguration();
  if (!command) return chooseMode(ctx, configuration, applyConfiguration);
  if (await handleInformationCommand(command, ctx, state, configuration, getSourceEntries)) return;
  if (command === "toggle") {
    const mode = configuration.mode === "compact" ? "expanded" : "compact";
    await applyMode(mode, ctx, configuration, applyConfiguration);
    return;
  }
  if (isTurnFoldMode(command)) {
    await applyMode(command, ctx, configuration, applyConfiguration);
    return;
  }
  const argument = windowArgument(command);
  if (argument !== undefined) {
    await applyWindowArgument(argument, ctx, configuration, applyConfiguration);
    return;
  }
  ctx.ui.notify(
    "Usage: /turn-fold [compact|expanded|history|status|toggle|windows <N|+N|-N|all|reset>]",
    "warning",
  );
}

function registerControls(
  pi: ExtensionAPI,
  state: TurnFoldState,
  shortcut: ToggleShortcutController,
  getConfiguration: GetConfiguration,
  applyConfiguration: ApplyConfiguration,
  getSourceEntries: () => BranchEntries,
): void {
  pi.registerCommand("turn-fold", {
    description: "Control transcript folding and loaded compaction windows.",
    getArgumentCompletions: argumentCompletions,
    handler: (args, ctx) => {
      const action = () =>
        handleCommand(args, ctx, state, getConfiguration, applyConfiguration, getSourceEntries);
      return args.trim().toLowerCase() === "toggle" ? shortcut.run(action) : action();
    },
  });
}

type TurnFoldRuntime = {
  adapter: TranscriptWindowAdapter | undefined;
  configuration: TurnFoldConfiguration;
  currentTheme: Theme | undefined;
  ensureShrinkClearing: () => void;
  lastSourceEntries: BranchEntries;
  restoreEditor: () => void;
  runBoundaries: RunBoundaryRecorder;
};

function applyTranscriptProjection(
  entries: BranchEntries,
  state: TurnFoldState,
  runtime: TurnFoldRuntime,
  ctx: ExtensionContext,
  registry: EphemeralCompactionRegistry,
): BranchEntries {
  const branch = ctx.sessionManager.getBranch();
  const associations = compactionAssociationsForBranch(branch, ctx, registry);
  const projection = projectTranscriptEntries(entries, {
    activeRun: state.hasActive(),
    attachedCompactionEntryIds: new Set(associations.keys()),
    mode: runtime.configuration.mode,
  });
  state.setWorkingDirectory(ctx.cwd);
  state.applyHistoryProjection(
    projection.sourceEntries,
    projection.displayEntries,
    associations,
    projection.omittedRunCount,
    projection.oldestRetainedEntryId,
  );
  runtime.lastSourceEntries = projection.sourceEntries;
  return projection.displayEntries;
}

function transcriptProjector(
  state: TurnFoldState,
  runtime: TurnFoldRuntime,
  ctx: ExtensionContext,
  registry: EphemeralCompactionRegistry,
): (entries: BranchEntries) => BranchEntries {
  return (entries) => applyTranscriptProjection(entries, state, runtime, ctx, registry);
}

function registerSessionEvents(
  pi: ExtensionAPI,
  state: TurnFoldState,
  shortcut: ToggleShortcutController,
  runtime: TurnFoldRuntime,
  registry: EphemeralCompactionRegistry,
  applyConfiguration: ApplyConfiguration,
  restorePatches: () => void,
): void {
  pi.on("session_start", (_event, ctx) => {
    runtime.currentTheme = ctx.ui.theme;
    runtime.runBoundaries.reset();
    const branch = ctx.sessionManager.getBranch();
    runtime.configuration = configurationFromBranch(branch);
    runtime.lastSourceEntries = selectTranscriptEntries(branch, runtime.configuration.windows);
    applyTranscriptProjection(runtime.lastSourceEntries, state, runtime, ctx, registry);
    applyConfiguration(runtime.configuration, false);
    runtime.restoreEditor();
    runtime.ensureShrinkClearing = () => undefined;
    runtime.restoreEditor = () => undefined;
    if (ctx.mode !== "tui") {
      runtime.adapter = undefined;
      return;
    }
    const shortcutInstallation = installTurnFoldShortcutEditor(ctx, {
      cancel: (error) => {
        shortcut.cancel();
        if (error !== undefined) {
          const message =
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "Unknown error";
          ctx.ui.notify(`Turn Fold toggle failed: ${message}`, "error");
        }
      },
      request: () =>
        shortcut.request(ctx.isIdle(), (message, level) => {
          ctx.ui.notify(message, level);
        }),
    });
    runtime.ensureShrinkClearing = shortcutInstallation.ensureShrinkClearing;
    runtime.restoreEditor = shortcutInstallation.restore;
    runtime.adapter = installTranscriptWindowAdapter(
      ctx.sessionManager,
      runtime.configuration.windows,
      transcriptProjector(state, runtime, ctx, registry),
      (error) => {
        ctx.ui.notify(`Turn Fold projection disabled: ${error.message}`, "warning");
      },
    );
  });
  pi.on("session_compact", (event, ctx) => {
    runtime.currentTheme = ctx.ui.theme;
    runtime.adapter?.markPendingCompaction(event.compactionEntry.id);
    const branch = ctx.sessionManager.getBranch();
    const association = state.registerCompaction(
      event.compactionEntry,
      event.reason,
      turnEntryIds(branch, event.compactionEntry.id),
    );
    if (association) registry.remember(sessionRegistryKey(ctx), association);
  });
  pi.on("session_tree", (_event, ctx) => {
    runtime.currentTheme = ctx.ui.theme;
    const branch = ctx.sessionManager.getBranch();
    state.replaceCompactionAssociations(compactionAssociationsForBranch(branch, ctx, registry));
  });
  pi.on("session_shutdown", (event) => {
    runtime.runBoundaries.reset();
    runtime.adapter?.restore();
    runtime.adapter = undefined;
    runtime.restoreEditor();
    runtime.ensureShrinkClearing = () => undefined;
    runtime.restoreEditor = () => undefined;
    closeCompactionRegistry(registry, event.reason);
    restorePatches();
  });
}

function registerAgentEvents(
  pi: ExtensionAPI,
  state: TurnFoldState,
  runtime: TurnFoldRuntime,
): void {
  pi.on("agent_start", (_event, ctx) => {
    runtime.currentTheme = ctx.ui.theme;
    const hadActiveRun = state.hasActive();
    const startedAt = Date.now();
    state.ensureActive(startedAt);
    if (!hadActiveRun) runtime.runBoundaries.start(ctx.sessionManager.getBranch(), startedAt);
  });
  pi.on("message_start", (event, ctx) => {
    runtime.currentTheme = ctx.ui.theme;
    const role = messageRole(event.message);
    if (role === "user") {
      const previousRunId = state.activeId();
      const startedAt = messageTimestamp(event.message) ?? Date.now();
      const runId = state.startUserTurn(startedAt);
      if (runId !== previousRunId) {
        runtime.runBoundaries.start(ctx.sessionManager.getBranch(), startedAt);
      }
    }
    if (role === "assistant") state.beginAssistantMessage(event.message);
  });
  pi.on("message_update", (event, ctx) => {
    runtime.currentTheme = ctx.ui.theme;
    state.registerAssistantMessage(event.message);
  });
  pi.on("message_end", (event, ctx) => {
    runtime.currentTheme = ctx.ui.theme;
    registerEndedAssistant(state, event.message);
  });
  pi.on("turn_end", (event, ctx) => {
    for (const result of event.toolResults) state.registerToolResult(result);
    runtime.runBoundaries.persist(ctx.sessionManager.getBranch());
  });
  pi.on("tool_execution_start", (event, ctx) => {
    runtime.currentTheme = ctx.ui.theme;
    state.registerToolStart(event.toolCallId);
  });
  pi.on("tool_execution_end", (event, ctx) => {
    runtime.currentTheme = ctx.ui.theme;
    state.registerToolEnd(event.toolCallId, event.isError);
  });
  pi.on("agent_settled", (_event, ctx) => {
    runtime.currentTheme = ctx.ui.theme;
    runtime.runBoundaries.persist(ctx.sessionManager.getBranch());
    state.settleActive();
  });
}

export default function turnFold(pi: ExtensionAPI): void {
  const state = new TurnFoldState();
  const shortcut = new ToggleShortcutController();
  const registry = processCompactionRegistry();
  const runtime: TurnFoldRuntime = {
    adapter: undefined,
    configuration: DEFAULT_TURN_FOLD_CONFIGURATION,
    currentTheme: undefined,
    ensureShrinkClearing: () => undefined,
    lastSourceEntries: [],
    restoreEditor: () => undefined,
    runBoundaries: new RunBoundaryRecorder((customType, data) => {
      pi.appendEntry(customType, data);
    }),
  };
  const restorePatches = installRenderPatches(state, () => runtime.currentTheme);
  const applyConfiguration = (next: TurnFoldConfiguration, persist: boolean): void => {
    runtime.configuration = next;
    runtime.adapter?.setValue(next.windows);
    if (next.mode === "compact") runtime.ensureShrinkClearing();
    state.setMode(next.mode);
    if (persist) pi.appendEntry(TURN_FOLD_CONFIG_ENTRY, next);
  };
  registerControls(
    pi,
    state,
    shortcut,
    () => runtime.configuration,
    applyConfiguration,
    () => runtime.lastSourceEntries,
  );
  registerSessionEvents(pi, state, shortcut, runtime, registry, applyConfiguration, restorePatches);
  registerAgentEvents(pi, state, runtime);
}
