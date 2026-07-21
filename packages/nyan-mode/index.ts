import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";

import {
  createCatState,
  createNyanRunwayPainter,
  createTextNyanPainter,
  cumulativeApiCost,
  ensureKittyGraphics,
  formatApiCost,
  getNyanDebugInfo,
  reduceCatState,
  renderAnimatedNyanRunway,
  selectCatMood,
  type CatEvent,
  type CatMood,
  type CatState,
  type NyanRunwayPainter,
  type TextNyanPainter,
} from "./src/index.ts";
import {
  composeInlineImageLine,
  composeLine,
  fitRunway,
  formatContext,
  joinParts,
  shortModel,
  type FittedRunway,
} from "./src/layout.ts";

type NyanDisplayMode = "auto" | "bitmap" | "text";

type ActiveFooter = {
  bitmapPainter: NyanRunwayPainter;
  requestRender: () => void;
  textPainter: TextNyanPainter;
};

export default function nyanMode(pi: ExtensionAPI): void {
  let enabled = true;
  let displayMode: NyanDisplayMode = "text";
  let catState = createCatState();
  let activeFooter: ActiveFooter | undefined;

  const applyCatEvent = (event: CatEvent): void => {
    catState = reduceCatState(catState, event);
    syncActiveFooter(activeFooter, enabled, displayMode, catState);
  };
  registerCatEventHandlers(pi, applyCatEvent);

  pi.registerCommand("nyan", {
    description: "Toggle Nyan Mode footer",
    handler: (args, ctx) => {
      const value = args.trim().toLowerCase();
      if (value === "debug") {
        ctx.ui.notify(debugMessage(enabled, displayMode, catState, activeFooter), "info");
        return Promise.resolve();
      }
      const notify = (message: string): void => {
        ctx.ui.notify(message, "info");
      };
      const requestedMode = nyanDisplayMode(value);
      if (requestedMode) {
        enabled = true;
        displayMode = requestedMode;
        activateDisplayMode(displayMode, catState, activeFooter, notify);
        return Promise.resolve();
      }

      enabled = nextEnabled(value, enabled);
      applyEnabled(enabled, displayMode, catState, activeFooter, notify);
      return Promise.resolve();
    },
  });

  pi.on("session_start", (_event, ctx) => {
    catState = createCatState();
    installNyanFooter(pi, ctx, {
      activate: (footer) => {
        activeFooter = footer;
      },
      deactivate: (footer) => {
        if (activeFooter === footer) activeFooter = undefined;
      },
      getCatState: () => catState,
      getDisplayMode: () => displayMode,
      getEnabled: () => enabled,
    });
  });

  pi.on("session_shutdown", () => {
    activeFooter?.bitmapPainter.clear();
    activeFooter?.textPainter.clear();
  });
}

type FooterLifecycle = {
  activate: (footer: ActiveFooter) => void;
  deactivate: (footer: ActiveFooter) => void;
  getCatState: () => CatState;
  getDisplayMode: () => NyanDisplayMode;
  getEnabled: () => boolean;
};

function installNyanFooter(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  lifecycle: FooterLifecycle,
): void {
  ctx.ui.setFooter((tui, theme, footerData) => {
    const requestRender = (): void => {
      tui.requestRender();
    };
    const footer: ActiveFooter = {
      bitmapPainter: createNyanRunwayPainter(tui),
      requestRender,
      textPainter: createTextNyanPainter(requestRender),
    };
    let disposed = false;
    lifecycle.activate(footer);
    syncActiveFooter(
      footer,
      lifecycle.getEnabled(),
      lifecycle.getDisplayMode(),
      lifecycle.getCatState(),
    );
    const unsubscribeBranch = footerData.onBranchChange(requestRender);
    void ensureKittyGraphics(tui).then(() => {
      if (!disposed) requestRender();
    });

    return {
      dispose(): void {
        disposed = true;
        unsubscribeBranch();
        footer.bitmapPainter.dispose();
        footer.textPainter.dispose();
        lifecycle.deactivate(footer);
      },
      invalidate(): void {
        footer.bitmapPainter.clear();
      },
      render(width: number): string[] {
        const catState = lifecycle.getCatState();
        const mood = selectCatMood(catState, Date.now());
        return [
          renderFooterLine({
            ...footerSnapshot(ctx, mood),
            bitmapPainter: footer.bitmapPainter,
            branch: footerData.getGitBranch(),
            displayMode: lifecycle.getDisplayMode(),
            enabled: lifecycle.getEnabled(),
            textPainter: footer.textPainter,
            theme,
            thinkingLevel: pi.getThinkingLevel(),
            width,
          }),
        ];
      },
    };
  });
}

function registerCatEventHandlers(pi: ExtensionAPI, apply: (event: CatEvent) => void): void {
  pi.on("agent_start", () => {
    apply({ type: "stream_started", nowMs: Date.now() });
  });
  pi.on("agent_end", () => {
    apply({ type: "stream_stopped" });
  });
  pi.on("tool_execution_start", (event) => {
    apply({ type: "tool_started", toolCallId: event.toolCallId });
  });
  pi.on("tool_execution_end", (event) => {
    apply({
      type: "tool_finished",
      toolCallId: event.toolCallId,
      isError: event.isError,
      nowMs: Date.now(),
    });
  });
}

function syncActiveFooter(
  footer: ActiveFooter | undefined,
  enabled: boolean,
  displayMode: NyanDisplayMode,
  catState: CatState,
): void {
  if (!footer) return;
  footer.textPainter.setStreaming(enabled && catState.streaming && displayMode !== "bitmap");
  footer.requestRender();
}

function nyanDisplayMode(value: string): NyanDisplayMode | undefined {
  return value === "auto" || value === "bitmap" || value === "text" ? value : undefined;
}

function nextEnabled(value: string, enabled: boolean): boolean {
  if (value === "on") return true;
  if (value === "off") return false;
  return !enabled;
}

function activateDisplayMode(
  displayMode: NyanDisplayMode,
  catState: CatState,
  footer: ActiveFooter | undefined,
  notify: (message: string) => void,
): void {
  if (displayMode === "text") footer?.bitmapPainter.clear();
  if (displayMode === "bitmap") footer?.textPainter.clear();
  notify(`Nyan Mode ${displayMode}`);
  syncActiveFooter(footer, true, displayMode, catState);
}

function applyEnabled(
  enabled: boolean,
  displayMode: NyanDisplayMode,
  catState: CatState,
  footer: ActiveFooter | undefined,
  notify: (message: string) => void,
): void {
  if (!enabled) {
    footer?.bitmapPainter.clear();
    footer?.textPainter.clear();
  }
  notify(`Nyan Mode ${enabled ? "enabled" : "disabled"}`);
  syncActiveFooter(footer, enabled, displayMode, catState);
}

function debugMessage(
  enabled: boolean,
  displayMode: NyanDisplayMode,
  catState: CatState,
  footer: ActiveFooter | undefined,
): string {
  const info = getNyanDebugInfo();
  return joinParts([
    "Nyan:",
    `enabled=${String(enabled)}`,
    `mode=${displayMode}`,
    `mood=${selectCatMood(catState, Date.now())}`,
    `errors=${String(catState.errorCount)}`,
    `supported=${String(info.supported)}`,
    `imageProtocol=${info.imageProtocol ?? "none"}`,
    `assets=${String(info.assetsAvailable)}`,
    `bitmap=${footer?.bitmapPainter.debugInfo() ?? "none"}`,
    `text=${footer?.textPainter.debugInfo() ?? "none"}`,
  ]);
}

type FooterSnapshot = {
  contextWindow: number | undefined;
  cumulativeCost: number;
  modelId: string | undefined;
  mood: CatMood;
  percent: number | undefined;
  project: string;
  reasoning: boolean | undefined;
  usingSubscription: boolean;
};

type FooterLineOptions = FooterSnapshot & {
  bitmapPainter: NyanRunwayPainter;
  branch: string | null;
  displayMode: NyanDisplayMode;
  enabled: boolean;
  textPainter: TextNyanPainter;
  theme: Theme;
  thinkingLevel: string;
  width: number;
};

function footerSnapshot(ctx: ExtensionContext, mood: CatMood): FooterSnapshot {
  const project = basename(ctx.cwd);
  return {
    ...usageSnapshot(ctx),
    ...modelSnapshot(ctx),
    cumulativeCost: cumulativeApiCost(ctx.sessionManager.getEntries()),
    mood,
    project: project || ctx.cwd,
    usingSubscription: usingSubscription(ctx),
  };
}

function usingSubscription(ctx: ExtensionContext): boolean {
  if (!ctx.model) return false;
  const model = ctx.modelRegistry.find(ctx.model.provider, ctx.model.id);
  return model ? ctx.modelRegistry.isUsingOAuth(model) : false;
}

function usageSnapshot(ctx: ExtensionContext): Pick<FooterSnapshot, "contextWindow" | "percent"> {
  const context = ctx.getContextUsage();
  return {
    contextWindow: context?.contextWindow ?? ctx.model?.contextWindow,
    percent: context?.percent ?? undefined,
  };
}

function modelSnapshot(ctx: ExtensionContext): Pick<FooterSnapshot, "modelId" | "reasoning"> {
  return { modelId: ctx.model?.id, reasoning: ctx.model?.reasoning };
}

function renderFooterLine(options: FooterLineOptions): string {
  const model = options.modelId ? shortModel(options.modelId) : "no-model";
  const left = leftFooter(options.theme, options.project, options.branch);
  const right = rightFooter(
    options.theme,
    options.cumulativeCost,
    options.usingSubscription,
    options.percent,
    options.contextWindow,
    model,
    options.reasoning,
    options.thinkingLevel,
  );
  const nyanLine = options.enabled
    ? composeNyanLine(
        options.bitmapPainter,
        options.textPainter,
        options.mood,
        left,
        right,
        options.percent,
        options.width,
        options.displayMode,
      )
    : undefined;
  return nyanLine ?? composeLine(left, "", right, options.width);
}

function leftFooter(theme: Theme, project: string, branch: string | null): string {
  return joinParts([
    theme.fg("accent", "π"),
    theme.fg("text", branch ? `${project}  ${branch}` : project),
  ]);
}

function rightFooter(
  theme: Theme,
  cumulativeCost: number,
  usingSubscription: boolean,
  percent: number | undefined,
  contextWindow: number | undefined,
  model: string,
  reasoning: boolean | undefined,
  thinkingLevel: string,
): string {
  return joinParts([
    mutedLabel(theme, formatApiCost(cumulativeCost, usingSubscription)),
    colorContext(theme, percent, formatContext(percent, contextWindow)),
    reasoning ? theme.fg("muted", `think ${thinkingLevel}`) : undefined,
    theme.fg("accent", model),
  ]);
}

function composeNyanLine(
  bitmapPainter: NyanRunwayPainter,
  textPainter: TextNyanPainter,
  mood: CatMood,
  left: string,
  right: string,
  percent: number | undefined,
  width: number,
  displayMode: NyanDisplayMode,
): string | undefined {
  const layout = fitRunway(left, right, width);
  if (!layout) {
    bitmapPainter.clear();
    return undefined;
  }
  const bitmap = renderBitmapRunway(bitmapPainter, layout, percent, displayMode);
  if (bitmap) return composeInlineImageLine(layout.left, bitmap, layout.right, layout.cells);
  if (displayMode === "bitmap") return undefined;
  const text = textPainter.render(layout.cells, percent, mood);
  return text ? `${layout.left} ${text} ${layout.right}` : undefined;
}

function renderBitmapRunway(
  painter: NyanRunwayPainter,
  layout: FittedRunway,
  percent: number | undefined,
  displayMode: NyanDisplayMode,
): string | undefined {
  if (displayMode === "text") {
    painter.clear();
    return undefined;
  }
  return percent === undefined
    ? renderAnimatedNyanRunway(painter, {
        cells: layout.cells,
        startColumn: layout.startColumn,
      })
    : renderAnimatedNyanRunway(painter, {
        percent,
        cells: layout.cells,
        startColumn: layout.startColumn,
      });
}

function mutedLabel(theme: Theme, label: string | undefined): string | undefined {
  return label ? theme.fg("muted", label) : undefined;
}

function colorContext(theme: Theme, percent: number | undefined, label: string): string {
  if (percent !== undefined && percent >= 90) return theme.fg("error", label);
  if (percent !== undefined && percent >= 70) return theme.fg("warning", label);
  return theme.fg("success", label);
}
