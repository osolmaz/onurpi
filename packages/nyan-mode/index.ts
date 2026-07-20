import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";

import {
  createNyanRunwayPainter,
  cumulativeApiCost,
  ensureKittyGraphics,
  formatApiCost,
  getNyanDebugInfo,
  renderAnimatedNyanRunway,
  renderTextNyan,
  type NyanRunwayPainter,
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

const TEXT_ANIMATION_INTERVAL_MS = 500;

export default function nyanMode(pi: ExtensionAPI): void {
  let enabled = true;
  let displayMode: NyanDisplayMode = "text";
  let renderFooter: (() => void) | undefined;
  let activePainter: NyanRunwayPainter | undefined;

  pi.registerCommand("nyan", {
    description: "Toggle Nyan Mode footer",
    handler: (args, ctx) => {
      const value = args.trim().toLowerCase();
      if (value === "debug") {
        ctx.ui.notify(debugMessage(enabled, displayMode, activePainter), "info");
        return Promise.resolve();
      }
      const notify = (message: string): void => {
        ctx.ui.notify(message, "info");
      };
      const requestedMode = nyanDisplayMode(value);
      if (requestedMode) {
        enabled = true;
        displayMode = requestedMode;
        activateDisplayMode(displayMode, activePainter, renderFooter, notify);
        return Promise.resolve();
      }

      enabled = nextEnabled(value, enabled);
      applyEnabled(enabled, activePainter, renderFooter, notify);
      return Promise.resolve();
    },
  });

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const requestRender = (): void => {
        tui.requestRender();
      };
      const painter = createNyanRunwayPainter(tui);
      let disposed = false;
      renderFooter = requestRender;
      activePainter = painter;
      const unsubscribeBranch = footerData.onBranchChange(requestRender);
      void ensureKittyGraphics(tui).then(() => {
        if (!disposed) requestRender();
      });

      return {
        dispose(): void {
          disposed = true;
          unsubscribeBranch();
          painter.dispose();
          if (renderFooter === requestRender) renderFooter = undefined;
          if (activePainter === painter) activePainter = undefined;
        },
        invalidate(): void {
          painter.clear();
        },
        render(width: number): string[] {
          return [
            renderFooterLine({
              ...footerSnapshot(ctx),
              branch: footerData.getGitBranch(),
              displayMode,
              enabled,
              painter,
              theme,
              thinkingLevel: pi.getThinkingLevel(),
              width,
            }),
          ];
        },
      };
    });
  });

  pi.on("session_shutdown", () => {
    activePainter?.clear();
  });
}

type NyanDisplayMode = "auto" | "bitmap" | "text";

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
  painter: NyanRunwayPainter | undefined,
  renderFooter: (() => void) | undefined,
  notify: (message: string) => void,
): void {
  if (displayMode === "text") painter?.clear();
  notify(`Nyan Mode ${displayMode}`);
  renderFooter?.();
}

function applyEnabled(
  enabled: boolean,
  painter: NyanRunwayPainter | undefined,
  renderFooter: (() => void) | undefined,
  notify: (message: string) => void,
): void {
  if (!enabled) painter?.clear();
  notify(`Nyan Mode ${enabled ? "enabled" : "disabled"}`);
  renderFooter?.();
}

function debugMessage(
  enabled: boolean,
  displayMode: NyanDisplayMode,
  painter: NyanRunwayPainter | undefined,
): string {
  const info = getNyanDebugInfo();
  return joinParts([
    "Nyan:",
    `enabled=${String(enabled)}`,
    `mode=${displayMode}`,
    `supported=${String(info.supported)}`,
    `imageProtocol=${info.imageProtocol ?? "none"}`,
    `assets=${String(info.assetsAvailable)}`,
    `painter=${painter?.debugInfo() ?? "none"}`,
  ]);
}

type FooterSnapshot = {
  animationFrame: number;
  contextWindow: number | undefined;
  cumulativeCost: number;
  dancing: boolean;
  modelId: string | undefined;
  percent: number | undefined;
  project: string;
  reasoning: boolean | undefined;
  usingSubscription: boolean;
};

type FooterLineOptions = FooterSnapshot & {
  branch: string | null;
  displayMode: NyanDisplayMode;
  enabled: boolean;
  painter: NyanRunwayPainter;
  theme: Theme;
  thinkingLevel: string;
  width: number;
};

function footerSnapshot(ctx: ExtensionContext): FooterSnapshot {
  const project = basename(ctx.cwd);
  return {
    ...usageSnapshot(ctx),
    ...modelSnapshot(ctx),
    animationFrame: Math.floor(Date.now() / TEXT_ANIMATION_INTERVAL_MS),
    cumulativeCost: cumulativeApiCost(ctx.sessionManager.getEntries()),
    dancing: !ctx.isIdle(),
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
        options.painter,
        options.animationFrame,
        options.dancing,
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
  painter: NyanRunwayPainter,
  animationFrame: number,
  dancing: boolean,
  left: string,
  right: string,
  percent: number | undefined,
  width: number,
  displayMode: NyanDisplayMode,
): string | undefined {
  const layout = fitRunway(left, right, width);
  if (!layout) {
    painter.clear();
    return undefined;
  }
  const bitmap = renderBitmapRunway(painter, layout, percent, displayMode);
  if (bitmap) return composeInlineImageLine(layout.left, bitmap, layout.right, layout.cells);
  if (displayMode === "bitmap") return undefined;
  const text = renderTextNyan(layout.cells, percent, dancing, animationFrame);
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
