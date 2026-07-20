import type { DeliveryGate } from "./delivery-policy.ts";
import type { QueueItem } from "./queue-model.ts";

export type WidgetPalette = {
  accent(text: string): string;
  dim(text: string): string;
  warning(text: string): string;
};

const PREVIEW_WIDTH = 72;
const MAX_WIDGET_ITEMS = 5;

/** First line of a prompt, marked and truncated when content is cut off. */
export function previewText(text: string, maxWidth: number = PREVIEW_WIDTH): string {
  const newline = text.indexOf("\n");
  const firstLine = (newline === -1 ? text : text.slice(0, newline)).trim();
  const multiline = firstLine.length < text.trim().length;
  const base = multiline ? `${firstLine} …` : firstLine;
  if (base.length <= maxWidth) return base;
  return `${base.slice(0, Math.max(maxWidth - 1, 0))}…`;
}

function itemLine(item: QueueItem, position: number, palette: WidgetPalette): string {
  const label = item.mode === "steer" ? palette.warning("will steer") : palette.accent("queued");
  return `${palette.dim(`${String(position)}.`)} ${label} ${previewText(item.text)}`;
}

function statusLine(gate: DeliveryGate, palette: WidgetPalette): string {
  if (gate.windowOpen || gate.held) {
    return palette.warning("prompt queue paused") + palette.dim(" — press ↑ to manage");
  }
  return palette.dim("↑ manage queue");
}

/**
 * Lines rendered above the prompt editor. Empty when there is nothing to
 * show; capped so a long queue cannot crowd out the transcript.
 */
export function widgetLines(
  items: readonly QueueItem[],
  gate: DeliveryGate,
  palette: WidgetPalette,
): string[] {
  if (items.length === 0 && !gate.held && !gate.windowOpen) return [];
  const shown = items.slice(0, MAX_WIDGET_ITEMS);
  const lines = shown.map((item, index) => itemLine(item, index + 1, palette));
  if (items.length > shown.length) {
    lines.push(palette.dim(`… ${String(items.length - shown.length)} more queued`));
  }
  lines.push(statusLine(gate, palette));
  return lines;
}
