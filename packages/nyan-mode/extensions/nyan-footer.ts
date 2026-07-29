import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { basename } from "node:path";
import { createNyanRunwayPainter, getNyanDebugInfo, renderAnimatedNyanRunway, type NyanRunwayPainter } from "../src/index";

let enabled = true;
let renderFooter: (() => void) | undefined;
let activePainter: NyanRunwayPainter | undefined;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("nyan", {
    description: "Toggle Nyan Mode footer",
    handler: async (args, ctx) => {
      const value = args.trim().toLowerCase();
      if (value === "on" || value === "bitmap") enabled = true;
      else if (value === "off") enabled = false;
      else if (value === "text") {
        ctx.ui.notify("Nyan text mode was removed; bitmap mode only.", "info");
        return;
      } else if (value === "debug") {
        const info = getNyanDebugInfo();
        ctx.ui.notify(
          `Nyan: enabled=${enabled} supported=${info.supported} imageProtocol=${info.imageProtocol ?? "none"} assets=${info.assetsAvailable} painter=${activePainter?.debugInfo() ?? "none"}`,
          "info",
        );
        return;
      } else enabled = !enabled;

      if (!enabled) activePainter?.clear();
      ctx.ui.notify(`Nyan Mode ${enabled ? "enabled" : "disabled"}`, "info");
      renderFooter?.();
    },
  });

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const requestRender = () => tui.requestRender();
      const painter = createNyanRunwayPainter(tui);
      renderFooter = requestRender;
      activePainter = painter;
      const unsubscribeBranch = footerData.onBranchChange(requestRender);

      return {
        dispose() {
          unsubscribeBranch();
          painter.dispose();
          if (renderFooter === requestRender) renderFooter = undefined;
          if (activePainter === painter) activePainter = undefined;
        },

        invalidate() {},

        render(width: number): string[] {
          const context = ctx.getContextUsage();
          const contextPercent = context?.percent ?? undefined;
          const contextWindow = context?.contextWindow ?? ctx.model?.contextWindow;
          const project = basename(ctx.cwd) || ctx.cwd;
          const branch = footerData.getGitBranch();
          const model = ctx.model?.id ? shortModel(ctx.model.id) : "no-model";

          const left = joinParts([
            theme.bg("toolSuccessBg", theme.fg("text", " NYAN ")),
            theme.fg("accent", "π"),
            theme.fg("text", branch ? `${project}  ${branch}` : project),
          ]);
          const right = joinParts([
            colorContext(theme, contextPercent, formatContext(contextPercent, contextWindow)),
            ctx.model?.reasoning ? theme.fg("muted", `think ${pi.getThinkingLevel()}`) : undefined,
            theme.fg("accent", model),
          ]);

          if (enabled) {
            const line = composeNyanLine(painter, left, right, contextPercent, width);
            if (line) return [line];
          }

          return [composeLine(left, "", right, width)];
        },
      };
    });
  });
}

function composeNyanLine(painter: NyanRunwayPainter, left: string, right: string, percent: number | undefined, width: number) {
  const minTrack = 8;
  let leftPart = left;
  let rightPart = right;
  let leftWidth = visibleWidth(leftPart);
  let rightWidth = visibleWidth(rightPart);

  if (leftWidth + rightWidth + minTrack + 2 > width) {
    leftPart = truncateToWidth(leftPart, Math.max(10, Math.floor(width * 0.34)), "…");
    leftWidth = visibleWidth(leftPart);
  }

  if (leftWidth + rightWidth + minTrack + 2 > width) {
    rightPart = truncateToWidth(rightPart, Math.max(8, width - leftWidth - minTrack - 2), "");
    rightWidth = visibleWidth(rightPart);
  }

  const trackWidth = width - leftWidth - rightWidth - 2;
  if (trackWidth < minTrack) {
    painter.clear();
    return undefined;
  }

  const startColumn = leftWidth + 2;
  const nyan = renderAnimatedNyanRunway(painter, { percent, cells: trackWidth, startColumn });
  if (!nyan) return undefined;
  return `${leftPart} ${nyan} ${rightPart}`;
}

function composeLine(left: string, center: string, right: string, width: number) {
  if (width <= 0) return "";

  const full = joinParts([left, center, right]);
  if (visibleWidth(full) <= width) {
    const leftCenter = joinParts([left, center]);
    const padding = " ".repeat(Math.max(1, width - visibleWidth(leftCenter) - visibleWidth(right)));
    return truncateToWidth(leftCenter + padding + right, width, "");
  }

  const minRight = Math.min(Math.max(20, Math.floor(width * 0.35)), visibleWidth(right));
  const availableLeft = Math.max(1, width - minRight - 1);
  const trimmedLeft = truncateToWidth(left, availableLeft, "…");
  const trimmedRight = truncateToWidth(right, Math.max(1, width - visibleWidth(trimmedLeft) - 1), "");
  const padding = " ".repeat(Math.max(1, width - visibleWidth(trimmedLeft) - visibleWidth(trimmedRight)));
  return truncateToWidth(trimmedLeft + padding + trimmedRight, width, "");
}

function colorContext(theme: any, percent: number | undefined, label: string) {
  if (percent !== undefined && percent >= 90) return theme.fg("error", label);
  if (percent !== undefined && percent >= 70) return theme.fg("warning", label);
  return theme.fg("success", label);
}

function formatContext(percent: number | undefined, contextWindow: number | undefined) {
  const window = contextWindow ? formatCount(contextWindow) : "?";
  if (percent === undefined || percent === null) return `ctx ?/${window}`;
  return `ctx ${percent.toFixed(0)}%/${window}`;
}

function formatCount(n: number) {
  if (n < 1000) return `${n}`;
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}

function shortModel(id: string) {
  return id
    .replace(/^claude-/, "")
    .replace(/^gpt-/, "gpt")
    .replace(/-20\d{6}$/, "")
    .replace(/-latest$/, "")
    .replace(/-preview$/, "");
}

function joinParts(parts: Array<string | undefined>) {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}
