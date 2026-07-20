import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type FittedRunway = {
  cells: number;
  left: string;
  right: string;
  startColumn: number;
};

export function fitRunway(
  left: string,
  right: string,
  width: number,
  minimumCells = 8,
): FittedRunway | undefined {
  let leftPart = left;
  let rightPart = right;
  let leftWidth = visibleWidth(leftPart);
  let rightWidth = visibleWidth(rightPart);

  if (leftWidth + rightWidth + minimumCells + 2 > width) {
    leftPart = truncateToWidth(leftPart, Math.max(10, Math.floor(width * 0.34)), "…");
    leftWidth = visibleWidth(leftPart);
  }
  if (leftWidth + rightWidth + minimumCells + 2 > width) {
    rightPart = truncateToWidth(rightPart, Math.max(8, width - leftWidth - minimumCells - 2), "");
    rightWidth = visibleWidth(rightPart);
  }

  const cells = width - leftWidth - rightWidth - 2;
  if (cells < minimumCells) return undefined;
  return { cells, left: leftPart, right: rightPart, startColumn: leftWidth + 2 };
}

export function composeLine(left: string, center: string, right: string, width: number): string {
  if (width <= 0) return "";
  const full = joinParts([left, center, right]);
  if (visibleWidth(full) <= width) return paddedLine(left, center, right, width);

  const minimumRight = Math.min(Math.max(20, Math.floor(width * 0.35)), visibleWidth(right));
  const availableLeft = Math.max(1, width - minimumRight - 1);
  const trimmedLeft = truncateToWidth(left, availableLeft, "…");
  const trimmedRight = truncateToWidth(
    right,
    Math.max(1, width - visibleWidth(trimmedLeft) - 1),
    "",
  );
  return paddedLine(trimmedLeft, "", trimmedRight, width);
}

function paddedLine(left: string, center: string, right: string, width: number): string {
  const leftCenter = joinParts([left, center]);
  const padding = " ".repeat(Math.max(1, width - visibleWidth(leftCenter) - visibleWidth(right)));
  return truncateToWidth(leftCenter + padding + right, width, "");
}

export function formatContext(
  percent: number | undefined,
  contextWindow: number | undefined,
): string {
  const window = contextWindow ? formatCount(contextWindow) : "?";
  return percent === undefined ? `ctx ?/${window}` : `ctx ${percent.toFixed(0)}%/${window}`;
}

export function formatCount(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 10_000) return `${(value / 1_000).toFixed(1)}k`;
  if (value < 1_000_000) return `${String(Math.round(value / 1_000))}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function shortModel(id: string): string {
  return id
    .replace(/^claude-/u, "")
    .replace(/^gpt-/u, "gpt")
    .replace(/-20\d{6}$/u, "")
    .replace(/-latest$/u, "")
    .replace(/-preview$/u, "");
}

export function joinParts(parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}
