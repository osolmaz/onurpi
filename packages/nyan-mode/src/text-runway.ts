import { visibleWidth } from "@earendil-works/pi-tui";

import type { CatMood } from "./cat-state.ts";
import { normalizeAvailableProgress } from "./progress.ts";

export type TextNyanOptions = {
  mood?: CatMood;
  animationFrame?: number;
};

type Rgb = readonly [red: number, green: number, blue: number];

const RAINBOW_STOPS: readonly Rgb[] = [
  [255, 45, 85],
  [255, 105, 35],
  [255, 190, 35],
  [235, 235, 45],
  [70, 220, 95],
  [30, 205, 205],
  [45, 125, 255],
  [105, 80, 255],
  [175, 70, 245],
  [240, 65, 180],
];
const CAT_CELLS = 10;
const RESET_FOREGROUND = "\x1b[39m";
const BOLD = "\x1b[1m";
const RESET_INTENSITY = "\x1b[22m";
const AHEAD_FOREGROUND = "\x1b[90m";
const CAT_POSES: Readonly<Record<CatMood, readonly string[]>> = {
  neutral: [" (=^･ω･^=)"],
  dancing: ["/(=^･ω･^=)", "(=^･ω･^=)\\", "\\(=^･ω･^=)", "(=^･ω･^=)/"],
  thinking: ["?(=･ω･=)  ", " (=･ω･=)? ", "  (=･ω･=)?"],
  focused: [">(=•ω•=)<", "<(=•ω•=)>", ">(=•ω•=)<"],
  pleased: ["*(=^ω^=)*", " (=^ω^=)ﾉ", "*(=^ω^=)*"],
  unimpressed: [" (=¬_¬=) ", "  (=¬_¬=)", " (=¬ω¬=) "],
  annoyed: ["!(=¬_¬=) ", " (=¬_¬=)!", "!(=¬ω¬=)!"],
  angry: ["!(=ಠ益ಠ=)!", "/(=ಠ益ಠ=)\\", "!(=ಠ益ಠ=)!", "\\(=ಠ益ಠ=)/"],
};

export function renderTextNyan(
  cells: number,
  percent?: number | null,
  options: TextNyanOptions = {},
): string {
  const width = Math.max(0, Math.floor(cells));
  if (width === 0) return "";

  const cat = renderCat(options.mood ?? "neutral", options.animationFrame ?? 0);
  if (width < CAT_CELLS) return `${rainbowTrail(width)}${RESET_FOREGROUND}`;

  const position = Math.round(normalizeAvailableProgress(percent) * (width - CAT_CELLS));
  const trail = rainbowTrail(position);
  const ahead = "·".repeat(width - position - CAT_CELLS);
  return `${trail}${RESET_FOREGROUND}${BOLD}${cat}${RESET_INTENSITY}${AHEAD_FOREGROUND}${ahead}${RESET_FOREGROUND}`;
}

export function renderCat(mood: CatMood, animationFrame: number): string {
  const poses = CAT_POSES[mood];
  const frame = Number.isFinite(animationFrame) ? Math.abs(Math.floor(animationFrame)) : 0;
  const pose = poses[frame % poses.length] ?? poses[0] ?? CAT_POSES.neutral[0];
  if (!pose) return " ".repeat(CAT_CELLS);
  const padding = CAT_CELLS - visibleWidth(pose);
  return padding < 0
    ? (CAT_POSES.neutral[0] ?? " ".repeat(CAT_CELLS))
    : `${pose}${" ".repeat(padding)}`;
}

function rainbowTrail(length: number): string {
  let output = "";
  for (let index = 0; index < length; index += 1) {
    const [red, green, blue] = rainbowColor(index, length);
    output += `\x1b[38;2;${String(red)};${String(green)};${String(blue)}m█`;
  }
  return output;
}

function rainbowColor(index: number, length: number): Rgb {
  if (length <= 1) return RAINBOW_STOPS[0] ?? [255, 45, 85];
  const scaled = (index / (length - 1)) * (RAINBOW_STOPS.length - 1);
  const lowerIndex = Math.floor(scaled);
  const upperIndex = Math.min(lowerIndex + 1, RAINBOW_STOPS.length - 1);
  const mix = scaled - lowerIndex;
  const lower = RAINBOW_STOPS[lowerIndex] ?? RAINBOW_STOPS[0] ?? [255, 45, 85];
  const upper = RAINBOW_STOPS[upperIndex] ?? lower;
  return [
    interpolate(lower[0], upper[0], mix),
    interpolate(lower[1], upper[1], mix),
    interpolate(lower[2], upper[2], mix),
  ];
}

function interpolate(start: number, end: number, mix: number): number {
  return Math.round(start + (end - start) * mix);
}
