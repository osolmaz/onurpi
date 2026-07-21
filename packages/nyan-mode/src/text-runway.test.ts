import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import type { CatMood } from "./cat-state.ts";
import { renderCat, renderTextNyan } from "./text-runway.ts";

const ESCAPE = String.fromCharCode(27);
const ANSI_FOREGROUND = new RegExp(`${ESCAPE}\\[(?:38;2;\\d+;\\d+;\\d+|1|22|39|90)m`, "gu");
const RGB_BLOCK = new RegExp(`${ESCAPE}\\[38;2;(\\d+);(\\d+);(\\d+)m█`, "gu");
const STREAMING_MOODS: readonly CatMood[] = [
  "dancing",
  "thinking",
  "focused",
  "pleased",
  "unimpressed",
  "annoyed",
  "angry",
];

function plain(text: string): string {
  return text.replace(ANSI_FOREGROUND, "");
}

function trailColors(text: string): string[] {
  return [...text.matchAll(RGB_BLOCK)].map((match) => [match[1], match[2], match[3]].join(","));
}

describe("ANSI Nyan runway", () => {
  it("draws a smooth full-height rainbow behind a normally colored cat", () => {
    const runway = renderTextNyan(80, 100);
    const colors = trailColors(runway);
    expect(visibleWidth(runway)).toBe(80);
    expect(plain(runway)).toBe(`${"█".repeat(70)} (=^･ω･^=)`);
    expect(runway).toContain(`${ESCAPE}[39m${ESCAPE}[1m (=^･ω･^=)${ESCAPE}[22m`);
    expect(colors).toHaveLength(70);
    expect(new Set(colors).size).toBeGreaterThan(60);
    expect(colors[0]).toBe("255,45,85");
    expect(colors.at(-1)).toBe("240,65,180");
  });

  it("keeps every streaming mood animated at a fixed width", () => {
    for (const mood of STREAMING_MOODS) {
      const first = renderCat(mood, 0);
      const second = renderCat(mood, 1);
      expect(visibleWidth(first), mood).toBe(10);
      expect(visibleWidth(second), mood).toBe(10);
      expect(second, mood).not.toBe(first);
    }
    expect(renderCat("neutral", Number.NaN)).toBe(renderCat("neutral", -1));
  });

  it("renders the selected mood on the context runway", () => {
    const runway = renderTextNyan(40, 50, { mood: "angry", animationFrame: 1 });
    expect(visibleWidth(runway)).toBe(40);
    expect(plain(runway)).toContain("/(=ಠ益ಠ=)\\");
  });

  it("uses a full-height rainbow bar when the runway is too narrow for the cat", () => {
    const runway = renderTextNyan(4.9, undefined);
    expect(visibleWidth(runway)).toBe(4);
    expect(plain(runway)).toBe("████");
    expect(renderTextNyan(0)).toBe("");
    expect(renderTextNyan(-2)).toBe("");
  });
});
