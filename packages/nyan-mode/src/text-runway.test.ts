import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { renderTextNyan } from "./text-runway.ts";

const ESCAPE = String.fromCharCode(27);
const ANSI_FOREGROUND = new RegExp(`${ESCAPE}\\[(?:38;5;\\d+|39|90)m`, "gu");
const RAINBOW_GLYPH = new RegExp(`${ESCAPE}\\[38;5;(\\d+)m━`, "gu");

function plain(text: string): string {
  return text.replace(ANSI_FOREGROUND, "");
}

function trailColors(text: string): number[] {
  return [...text.matchAll(RAINBOW_GLYPH)].map((match) => Number(match[1] ?? -1));
}

describe("ANSI Nyan runway", () => {
  it("elongates contiguous rainbow bands behind a normally colored cat", () => {
    const runway = renderTextNyan(80, 100);
    expect(visibleWidth(runway)).toBe(80);
    expect(plain(runway).endsWith(" (=^･ω･^=)")).toBe(true);
    expect(runway).toContain(`${ESCAPE}[39m (=^･ω･^=)`);
    expect(trailColors(runway)).toEqual(
      [196, 208, 226, 46, 51, 21, 201].flatMap((color) => Array<number>(10).fill(color)),
    );
  });

  it("alternates fixed-width dance poses", () => {
    const leftPaw = renderTextNyan(30, 50, true, 0);
    const rightPaw = renderTextNyan(30, 50, true, 1);
    expect(visibleWidth(leftPaw)).toBe(30);
    expect(visibleWidth(rightPaw)).toBe(30);
    expect(plain(leftPaw)).toContain("/(=^･ω･^=)");
    expect(plain(rightPaw)).toContain("(=^･ω･^=)\\");
  });

  it("uses a rainbow bar when the runway is too narrow for the cat", () => {
    const runway = renderTextNyan(4.9, undefined);
    expect(visibleWidth(runway)).toBe(4);
    expect(plain(runway)).toBe("━━━━");
    expect(renderTextNyan(0)).toBe("");
    expect(renderTextNyan(-2)).toBe("");
  });
});
