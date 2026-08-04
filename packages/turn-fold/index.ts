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
import { showHistoryExplorer } from "./history-viewer.ts";
import { isPreCompactionVisibility, nextPreCompactionVisibility } from "./history-scope.ts";
import { HistoryShortcutController, installTurnFoldShortcutEditor } from "./shortcut-editor.ts";
import {
  clearRestartMarker,
  matchingRestartMarker,
  rememberRestartMarker,
} from "./restart-marker.ts";
import { nearestRunStartIndex, RunBoundaryRecorder } from "./run-boundary.ts";
import {
  compactionWindowCount,
  formatTranscriptWindowValue,
  resolveWindowArgument,
} from "./transcript-windows.ts";
import {
  canApplyProjectionInPlace,
  entryIds,
  planSelectedTranscriptProjection,
  planTranscriptProjection,
  type TranscriptProjectionPlan,
} from "./projection-plan.ts";
import { TurnFoldState } from "./turn-state.ts";

const WINDOW_ARGUMENTS = ["1", "3", "+1", "-1", "all", "reset"] as const;

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

type RequestConfiguration = (
  configuration: TurnFoldConfiguration,
  ctx: ExtensionCommandContext,
  persist: boolean,
) => Promise<void>;
type GetConfiguration = () => TurnFoldConfiguration;
type GetRestartRequired = () => boolean;

const UPDATE_STATUS_KEY = "turn-fold-update";

async function renderInPlaceUpdate(ctx: ExtensionCommandContext): Promise<void> {
  ctx.ui.setStatus(UPDATE_STATUS_KEY, "Updating transcript");
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  ctx.ui.setStatus(UPDATE_STATUS_KEY, undefined);
}

function formatStatus(configuration: TurnFoldConfiguration, restartRequired: boolean): string {
  const status = `Turn fold: compact, pre-compaction ${configuration.preCompaction}, windows ${formatTranscriptWindowValue(configuration.windows)}`;
  return restartRequired ? `${status} (restart required)` : status;
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

function preCompactionCompletions(prefix: string): { label: string; value: string }[] {
  const normalized = prefix.trimStart().toLowerCase();
  if (!normalized.startsWith("pre-compaction")) return [];
  const argumentPrefix = normalized.slice("pre-compaction".length).trimStart();
  return ["show", "hide", "toggle"]
    .filter((value) => value.startsWith(argumentPrefix))
    .map((value) => ({ label: value, value: `pre-compaction ${value}` }));
}

function windowArgument(command: string): string | undefined {
  const match = /^windows(?:\s+(.*))?$/u.exec(command);
  return match?.[1]?.trim();
}

function preCompactionArgument(command: string): string | undefined {
  const match = /^pre-compaction(?:\s+(.*))?$/u.exec(command);
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
    `This will scan ${String(entries.length)} active-branch entries for compact summaries and can increase startup work.`,
  );
}

function argumentCompletions(prefix: string): { label: string; value: string }[] {
  const windows = windowCompletions(prefix);
  if (windows.length > 0) return windows;
  const preCompaction = preCompactionCompletions(prefix);
  if (preCompaction.length > 0) return preCompaction;
  return ["history", "pre-compaction", "status", "windows"]
    .filter((value) => value.startsWith(prefix.trim().toLowerCase()))
    .map((value) => ({ label: value, value }));
}

async function applyWindowArgument(
  argument: string,
  ctx: ExtensionCommandContext,
  configuration: TurnFoldConfiguration,
  requestConfiguration: RequestConfiguration,
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
  await requestConfiguration({ ...configuration, windows: resolved.value }, ctx, true);
}

async function applyPreCompactionArgument(
  argument: string,
  ctx: ExtensionCommandContext,
  configuration: TurnFoldConfiguration,
  requestConfiguration: RequestConfiguration,
): Promise<void> {
  const value =
    argument === "toggle" ? nextPreCompactionVisibility(configuration.preCompaction) : argument;
  if (!isPreCompactionVisibility(value)) {
    ctx.ui.notify("Use show, hide, or toggle.", "warning");
    return;
  }
  await requestConfiguration(
    { ...configuration, preCompaction: value },
    ctx,
    value !== configuration.preCompaction,
  );
}

function handleInformationCommand(
  command: string,
  ctx: ExtensionCommandContext,
  configuration: TurnFoldConfiguration,
  restartRequired: boolean,
): boolean {
  if (command === "status") {
    ctx.ui.notify(formatStatus(configuration, restartRequired), "info");
    return true;
  }
  if (command === "windows") {
    ctx.ui.notify(
      `Loaded compaction windows: ${formatTranscriptWindowValue(configuration.windows)}`,
      "info",
    );
    return true;
  }
  if (command === "pre-compaction") {
    ctx.ui.notify(`Pre-compaction messages: ${configuration.preCompaction}`, "info");
    return true;
  }
  return false;
}

type OpenHistory = (ctx: ExtensionCommandContext) => Promise<void>;

async function handleCommand(
  args: string,
  ctx: ExtensionCommandContext,
  getConfiguration: GetConfiguration,
  getRestartRequired: GetRestartRequired,
  requestConfiguration: RequestConfiguration,
  openHistory: OpenHistory,
): Promise<void> {
  const command = args.trim().toLowerCase();
  const configuration = getConfiguration();
  if (!command || command === "history") return openHistory(ctx);
  if (handleInformationCommand(command, ctx, configuration, getRestartRequired())) return;
  const preCompaction = preCompactionArgument(command);
  if (preCompaction !== undefined) {
    await applyPreCompactionArgument(preCompaction, ctx, configuration, requestConfiguration);
    return;
  }
  const windows = windowArgument(command);
  if (windows !== undefined) {
    await applyWindowArgument(windows, ctx, configuration, requestConfiguration);
    return;
  }
  ctx.ui.notify(
    "Usage: /turn-fold [history|pre-compaction <show|hide|toggle>|status|windows <N|+N|-N|all|reset>]",
    "warning",
  );
}

function registerControls(
  pi: ExtensionAPI,
  shortcut: HistoryShortcutController,
  getConfiguration: GetConfiguration,
  getRestartRequired: GetRestartRequired,
  requestConfiguration: RequestConfiguration,
  openHistory: OpenHistory,
): void {
  pi.registerCommand("turn-fold", {
    description: "Open history or control the compact transcript scope.",
    getArgumentCompletions: argumentCompletions,
    handler: (args, ctx) => {
      const action = () =>
        handleCommand(
          args,
          ctx,
          getConfiguration,
          getRestartRequired,
          requestConfiguration,
          openHistory,
        );
      const command = args.trim().toLowerCase();
      return !command || command === "history" ? shortcut.run(action) : action();
    },
  });
}

type TurnFoldRuntime = {
  adapter: TranscriptWindowAdapter | undefined;
  appliedConfiguration: TurnFoldConfiguration;
  closeExplorer: (() => void) | undefined;
  configuration: TurnFoldConfiguration;
  currentTheme: Theme | undefined;
  ensureShrinkClearing: () => void;
  knownEntryIds: Set<string>;
  loadedEntryIds: Set<string>;
  restartRequired: boolean;
  restoreEditor: () => void;
  runBoundaries: RunBoundaryRecorder;
};

function recordLoadedLiveEntries(runtime: TurnFoldRuntime, branch: BranchEntries): void {
  const currentEntryIds = entryIds(branch);
  for (const id of currentEntryIds) {
    if (!runtime.knownEntryIds.has(id)) runtime.loadedEntryIds.add(id);
  }
  runtime.knownEntryIds = currentEntryIds;
}

function sameConfiguration(left: TurnFoldConfiguration, right: TurnFoldConfiguration): boolean {
  return left.preCompaction === right.preCompaction && left.windows === right.windows;
}

function projectionOptions(
  state: TurnFoldState,
  associations: ReadonlyMap<string, EphemeralCompactionAssociation>,
) {
  return {
    activeRun: state.hasActive(),
    attachedCompactionEntryIds: new Set(associations.keys()),
  };
}

function applyProjectionPlanToState(
  plan: TranscriptProjectionPlan,
  state: TurnFoldState,
  associations: ReadonlyMap<string, EphemeralCompactionAssociation>,
  ctx: ExtensionContext,
): void {
  state.setWorkingDirectory(ctx.cwd);
  state.applyHistoryProjection(
    plan.sourceEntries,
    plan.displayEntries,
    associations,
    plan.omittedRunCount,
    plan.oldestRetainedEntryId,
  );
}

function applyTranscriptProjection(
  entries: BranchEntries,
  state: TurnFoldState,
  runtime: TurnFoldRuntime,
  ctx: ExtensionContext,
  registry: EphemeralCompactionRegistry,
): BranchEntries {
  const branch = ctx.sessionManager.getBranch();
  const associations = compactionAssociationsForBranch(branch, ctx, registry);
  const plan = planSelectedTranscriptProjection(
    entries,
    runtime.appliedConfiguration,
    projectionOptions(state, associations),
  );
  applyProjectionPlanToState(plan, state, associations, ctx);
  runtime.loadedEntryIds = new Set(plan.requiredEntryIds);
  if (sameConfiguration(runtime.configuration, runtime.appliedConfiguration)) {
    runtime.restartRequired = false;
  }
  return plan.displayEntries;
}

function transcriptProjector(
  state: TurnFoldState,
  runtime: TurnFoldRuntime,
  ctx: ExtensionContext,
  registry: EphemeralCompactionRegistry,
): (entries: BranchEntries) => BranchEntries {
  return (entries) => applyTranscriptProjection(entries, state, runtime, ctx, registry);
}

function startSession(
  ctx: ExtensionContext,
  state: TurnFoldState,
  shortcut: HistoryShortcutController,
  runtime: TurnFoldRuntime,
  registry: EphemeralCompactionRegistry,
): void {
  runtime.currentTheme = ctx.ui.theme;
  runtime.runBoundaries.reset();
  const branch = ctx.sessionManager.getBranch();
  const associations = compactionAssociationsForBranch(branch, ctx, registry);
  runtime.configuration = configurationFromBranch(branch);
  const sessionKey = sessionRegistryKey(ctx);
  const matchingMarker = matchingRestartMarker(sessionKey, runtime.configuration);
  runtime.appliedConfiguration = matchingMarker?.applied ?? runtime.configuration;
  const plan = planTranscriptProjection(
    branch,
    runtime.appliedConfiguration,
    projectionOptions(state, associations),
  );
  applyProjectionPlanToState(plan, state, associations, ctx);
  runtime.knownEntryIds = entryIds(branch);
  runtime.loadedEntryIds = new Set(plan.requiredEntryIds);
  runtime.restartRequired =
    matchingMarker !== undefined || !canApplyProjectionInPlace(plan, runtime.loadedEntryIds);
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
        ctx.ui.notify(`Turn Fold history failed: ${message}`, "error");
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
    runtime.appliedConfiguration.windows,
    transcriptProjector(state, runtime, ctx, registry),
    (error) => {
      ctx.ui.notify(`Turn Fold projection disabled: ${error.message}`, "warning");
    },
  );
}

function registerSessionEvents(
  pi: ExtensionAPI,
  state: TurnFoldState,
  shortcut: HistoryShortcutController,
  runtime: TurnFoldRuntime,
  registry: EphemeralCompactionRegistry,
  restorePatches: () => void,
): void {
  pi.on("session_start", (_event, ctx) => {
    runtime.closeExplorer?.();
    runtime.closeExplorer = undefined;
    startSession(ctx, state, shortcut, runtime, registry);
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
    runtime.closeExplorer?.();
    runtime.closeExplorer = undefined;
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
    recordLoadedLiveEntries(runtime, ctx.sessionManager.getBranch());
    state.settleActive();
  });
}

async function openHistoryForRuntime(
  runtime: TurnFoldRuntime,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Turn Fold history is available only in TUI mode.", "warning");
    return;
  }
  await ctx.waitForIdle();
  let activeClose: (() => void) | undefined;
  await showHistoryExplorer(ctx, ctx.sessionManager.getBranch(), {
    opened: (close) => {
      runtime.closeExplorer?.();
      activeClose = close;
      runtime.closeExplorer = close;
    },
    closed: () => {
      if (runtime.closeExplorer === activeClose) runtime.closeExplorer = undefined;
    },
  });
}

export default function turnFold(pi: ExtensionAPI): void {
  const state = new TurnFoldState();
  const shortcut = new HistoryShortcutController();
  const registry = processCompactionRegistry();
  const runtime: TurnFoldRuntime = {
    adapter: undefined,
    appliedConfiguration: DEFAULT_TURN_FOLD_CONFIGURATION,
    closeExplorer: undefined,
    configuration: DEFAULT_TURN_FOLD_CONFIGURATION,
    currentTheme: undefined,
    ensureShrinkClearing: () => undefined,
    knownEntryIds: new Set(),
    loadedEntryIds: new Set(),
    restartRequired: false,
    restoreEditor: () => undefined,
    runBoundaries: new RunBoundaryRecorder((customType, data) => {
      pi.appendEntry(customType, data);
    }),
  };
  const restorePatches = installRenderPatches(state, () => runtime.currentTheme);
  const requestConfiguration: RequestConfiguration = async (next, ctx, persist) => {
    await ctx.waitForIdle();
    const branch = ctx.sessionManager.getBranch();
    recordLoadedLiveEntries(runtime, branch);
    const associations = compactionAssociationsForBranch(branch, ctx, registry);
    const plan = planTranscriptProjection(branch, next, projectionOptions(state, associations));
    const canApplyInPlace = canApplyProjectionInPlace(plan, runtime.loadedEntryIds);
    if (!canApplyInPlace && ctx.mode === "tui" && !ctx.sessionManager.getSessionFile()) {
      ctx.ui.notify("Turn Fold widening requires a persisted session.", "warning");
      return;
    }

    runtime.configuration = next;
    if (persist) pi.appendEntry(TURN_FOLD_CONFIG_ENTRY, next);

    if (!canApplyInPlace) {
      runtime.restartRequired = true;
      rememberRestartMarker(sessionRegistryKey(ctx), {
        applied: runtime.appliedConfiguration,
        requested: next,
      });
      ctx.ui.notify(
        `${formatStatus(next, true)}. Restart Pi to load omitted transcript entries; /reload is not enough.`,
        "warning",
      );
      return;
    }

    runtime.appliedConfiguration = next;
    clearRestartMarker(sessionRegistryKey(ctx));
    runtime.adapter?.setValue(next.windows);
    runtime.restartRequired = false;
    runtime.ensureShrinkClearing();
    state.applyDisplayProjection(
      plan.displayEntries,
      plan.omittedRunCount,
      plan.oldestRetainedEntryId,
    );
    await renderInPlaceUpdate(ctx);
    ctx.ui.notify(formatStatus(next, false), "info");
  };
  registerControls(
    pi,
    shortcut,
    () => runtime.configuration,
    () => runtime.restartRequired,
    requestConfiguration,
    (ctx) => openHistoryForRuntime(runtime, ctx),
  );
  registerSessionEvents(pi, state, shortcut, runtime, registry, restorePatches);
  registerAgentEvents(pi, state, runtime);
}
