import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";

import {
  catStyler,
  createCatState,
  createNyanRunwayPainter,
  createTextNyanPainter,
  cumulativeApiCost,
  ensureKittyGraphics,
  formatApiCost,
  getNyanDebugInfo,
  minimumTextNyanCells,
  reduceCatState,
  remainingContextPercent,
  renderAnimatedNyanRunway,
  selectCatPresentation,
  type CatEvent,
  type CatPresentation,
  type CatState,
  type NyanRunwayPainter,
  type TextNyanPainter,
} from "./src/index.ts";
import {
  CODEX_WEEKLY_STATUS_ID,
  composeInlineImageLine,
  composeLine,
  extensionStatusText,
  fitRunway,
  formatExtensionStatusLine,
  formatRemainingContext,
  INLINE_EXTENSION_STATUS_IDS,
  joinParts,
  shortModel,
  type FittedRunway,
} from "./src/layout.ts";

export type NyanDisplayMode = "auto" | "bitmap" | "text";
export type FooterTheme = Pick<Theme, "fg">;

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
        ctx.ui.notify(debugMessage(ctx, enabled, displayMode, catState, activeFooter), "info");
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
        const statuses = footerData.getExtensionStatuses();
        const lines = [
          renderFooterLine({
            ...footerSnapshot(ctx, catState, Date.now()),
            bitmapPainter: footer.bitmapPainter,
            branch: footerData.getGitBranch(),
            displayMode: lifecycle.getDisplayMode(),
            enabled: lifecycle.getEnabled(),
            textPainter: footer.textPainter,
            theme,
            thinkingLevel: pi.getThinkingLevel(),
            weeklyUsage: extensionStatusText(statuses, CODEX_WEEKLY_STATUS_ID),
            width,
          }),
        ];
        const extensionStatuses = formatExtensionStatusLine(
          statuses,
          width,
          INLINE_EXTENSION_STATUS_IDS,
        );
        if (extensionStatuses) lines.push(extensionStatuses);
        return lines;
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
  ctx: ExtensionContext,
  enabled: boolean,
  displayMode: NyanDisplayMode,
  catState: CatState,
  footer: ActiveFooter | undefined,
): string {
  const info = getNyanDebugInfo();
  const usedPercent = ctx.getContextUsage()?.percent ?? undefined;
  const presentation = selectCatPresentation(
    catState,
    Date.now(),
    remainingContextPercent(usedPercent),
  );
  return joinParts([
    "Nyan:",
    `enabled=${String(enabled)}`,
    `mode=${displayMode}`,
    `mood=${presentation.mood}`,
    `contextStress=${presentation.contextStress}`,
    `remaining=${formatRemainingContext(usedPercent)}`,
    `errors=${String(catState.errorCount)}`,
    `supported=${String(info.supported)}`,
    `imageProtocol=${info.imageProtocol ?? "none"}`,
    `assets=${String(info.assetsAvailable)}`,
    `bitmap=${footer?.bitmapPainter.debugInfo() ?? "none"}`,
    `text=${footer?.textPainter.debugInfo() ?? "none"}`,
  ]);
}

export type FooterSnapshot = {
  cumulativeCost: number;
  modelId: string | undefined;
  presentation: CatPresentation;
  project: string;
  reasoning: boolean | undefined;
  usedPercent: number | undefined;
  usingSubscription: boolean;
};

export type FooterLineOptions = FooterSnapshot & {
  bitmapPainter: NyanRunwayPainter;
  branch: string | null;
  displayMode: NyanDisplayMode;
  enabled: boolean;
  textPainter: TextNyanPainter;
  theme: FooterTheme;
  thinkingLevel: string;
  weeklyUsage: string | undefined;
  width: number;
};

function footerSnapshot(ctx: ExtensionContext, catState: CatState, nowMs: number): FooterSnapshot {
  const project = basename(ctx.cwd);
  const usedPercent = ctx.getContextUsage()?.percent ?? undefined;
  return {
    ...modelSnapshot(ctx),
    cumulativeCost: cumulativeApiCost(ctx.sessionManager.getEntries()),
    presentation: selectCatPresentation(catState, nowMs, remainingContextPercent(usedPercent)),
    project: project || ctx.cwd,
    usedPercent,
    usingSubscription: usingSubscription(ctx),
  };
}

function usingSubscription(ctx: ExtensionContext): boolean {
  if (!ctx.model) return false;
  const model = ctx.modelRegistry.find(ctx.model.provider, ctx.model.id);
  return model ? ctx.modelRegistry.isUsingOAuth(model) : false;
}

function modelSnapshot(ctx: ExtensionContext): Pick<FooterSnapshot, "modelId" | "reasoning"> {
  return { modelId: ctx.model?.id, reasoning: ctx.model?.reasoning };
}

export function renderFooterLine(options: FooterLineOptions): string {
  const model = options.modelId ? shortModel(options.modelId) : "no-model";
  const left = leftFooter(
    options.theme,
    model,
    options.reasoning,
    options.thinkingLevel,
    options.project,
    options.branch,
  );
  const right = rightFooter(
    options.theme,
    options.cumulativeCost,
    options.usingSubscription,
    options.weeklyUsage,
  );
  const context = colorRemainingContext(
    options.theme,
    options.usedPercent,
    formatRemainingContext(options.usedPercent),
  );
  const nyanLine = options.enabled
    ? composeNyanLine(
        options.bitmapPainter,
        options.textPainter,
        options.presentation,
        left,
        context,
        right,
        options.usedPercent,
        options.width,
        options.displayMode,
        options.theme,
      )
    : undefined;
  return nyanLine ?? composeLine(left, "", joinParts([context, right]), options.width);
}

function leftFooter(
  theme: FooterTheme,
  model: string,
  reasoning: boolean | undefined,
  thinkingLevel: string,
  project: string,
  branch: string | null,
): string {
  return joinParts([
    theme.fg("accent", "π"),
    theme.fg("accent", model),
    reasoning ? theme.fg("muted", `(${thinkingLevel})`) : undefined,
    theme.fg("text", branch ? `${project}  ${branch}` : project),
  ]);
}

function rightFooter(
  theme: FooterTheme,
  cumulativeCost: number,
  usingSubscription: boolean,
  weeklyUsage: string | undefined,
): string {
  return joinParts([
    mutedLabel(theme, formatApiCost(cumulativeCost, usingSubscription)),
    mutedLabel(theme, weeklyUsage),
  ]);
}

function composeNyanLine(
  bitmapPainter: NyanRunwayPainter,
  textPainter: TextNyanPainter,
  presentation: CatPresentation,
  left: string,
  context: string,
  right: string,
  usedPercent: number | undefined,
  width: number,
  displayMode: NyanDisplayMode,
  theme: FooterTheme,
): string | undefined {
  const bitmapRight = joinParts([context, right]);
  const bitmapLayout = fitRunway(left, bitmapRight, width);
  if (bitmapLayout) {
    const bitmap = renderBitmapRunway(bitmapPainter, bitmapLayout, usedPercent, displayMode);
    if (bitmap) {
      return composeInlineImageLine(
        bitmapLayout.left,
        bitmap,
        bitmapLayout.right,
        bitmapLayout.cells,
      );
    }
  } else {
    bitmapPainter.clear();
  }
  if (displayMode === "bitmap") return undefined;

  const textLayout = fitRunway(left, right, width, minimumTextNyanCells(context));
  if (!textLayout) return undefined;
  const styleCat = catStyler(theme, presentation.contextStress);
  const text = textPainter.render(textLayout.cells, usedPercent, {
    catSuffix: context,
    mood: presentation.mood,
    ...(styleCat ? { styleCat } : {}),
  });
  return text ? `${textLayout.left} ${text} ${textLayout.right}` : undefined;
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

function mutedLabel(theme: FooterTheme, label: string | undefined): string | undefined {
  return label ? theme.fg("muted", label) : undefined;
}

function colorRemainingContext(
  theme: FooterTheme,
  usedPercent: number | undefined,
  label: string,
): string {
  const remaining = remainingContextPercent(usedPercent);
  if (remaining !== undefined && remaining <= 5) return theme.fg("error", label);
  if (remaining !== undefined && remaining <= 25) return theme.fg("warning", label);
  return theme.fg("success", label);
}
