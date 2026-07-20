import { visibleWidth } from "@earendil-works/pi-tui";

import { normalizeProgress } from "./progress.ts";

const RAINBOW_FOREGROUNDS = [196, 208, 226, 46, 51, 21, 201] as const;
const CAT = "(=^･ω･^=)";
const RESET_FOREGROUND = "\x1b[39m";
const AHEAD_FOREGROUND = "\x1b[90m";

export function renderTextNyan(cells: number, percent?: number | null): string {
  const width = Math.max(0, Math.floor(cells));
  if (width === 0) return "";

  const catWidth = visibleWidth(CAT);
  if (width < catWidth) return `${rainbowGlyphs("━".repeat(width), 0)}${RESET_FOREGROUND}`;

  const position = Math.round(normalizeProgress(percent) * (width - catWidth));
  const trail = rainbowGlyphs("━".repeat(position), 0);
  const cat = rainbowGlyphs(CAT, position);
  const ahead = "·".repeat(width - position - catWidth);
  return `${trail}${cat}${AHEAD_FOREGROUND}${ahead}${RESET_FOREGROUND}`;
}

function rainbowGlyphs(text: string, offset: number): string {
  let output = "";
  let index = 0;
  for (const glyph of text) {
    const color = RAINBOW_FOREGROUNDS[(offset + index) % RAINBOW_FOREGROUNDS.length];
    output += `\x1b[38;5;${String(color)}m${glyph}`;
    index += 1;
  }
  return output;
}
