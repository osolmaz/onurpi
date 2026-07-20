import { visibleWidth } from "@earendil-works/pi-tui";

import { normalizeProgress } from "./progress.ts";

const RAINBOW_FOREGROUNDS = [196, 208, 226, 46, 51, 21, 201] as const;
const CAT = "(=^･ω･^=)";
const IDLE_CAT = ` ${CAT}`;
const DANCING_CATS = [`/${CAT}`, `${CAT}\\`] as const;
const RESET_FOREGROUND = "\x1b[39m";
const AHEAD_FOREGROUND = "\x1b[90m";

export function renderTextNyan(
  cells: number,
  percent?: number | null,
  dancing = false,
  animationFrame = 0,
): string {
  const width = Math.max(0, Math.floor(cells));
  if (width === 0) return "";

  const frame = Number.isFinite(animationFrame) ? Math.abs(Math.floor(animationFrame)) : 0;
  const dancingCat = DANCING_CATS[frame % DANCING_CATS.length] ?? DANCING_CATS[0];
  const cat: string = dancing ? dancingCat : IDLE_CAT;
  const catWidth = visibleWidth(cat);
  if (width < catWidth) return `${rainbowTrail(width)}${RESET_FOREGROUND}`;

  const position = Math.round(normalizeProgress(percent) * (width - catWidth));
  const trail = rainbowTrail(position);
  const ahead = "·".repeat(width - position - catWidth);
  return `${trail}${RESET_FOREGROUND}${cat}${AHEAD_FOREGROUND}${ahead}${RESET_FOREGROUND}`;
}

function rainbowTrail(length: number): string {
  let output = "";
  for (let index = 0; index < length; index += 1) {
    const paletteIndex = Math.min(
      RAINBOW_FOREGROUNDS.length - 1,
      Math.floor((index * RAINBOW_FOREGROUNDS.length) / length),
    );
    output += `\x1b[38;5;${String(RAINBOW_FOREGROUNDS[paletteIndex])}m━`;
  }
  return output;
}
