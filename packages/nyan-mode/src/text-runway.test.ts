import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { renderTextNyan } from "./text-runway.ts";

const ANSI_FOREGROUND = new RegExp(`${String.fromCharCode(27)}\\[(?:38;5;\\d+|39|90)m`, "gu");

function plain(text: string): string {
  return text.replace(ANSI_FOREGROUND, "");
}

describe("ANSI Nyan runway", () => {
  it("moves a rainbow kaomoji across the requested cells", () => {
    const start = renderTextNyan(30, 0);
    const middle = renderTextNyan(30, 50);
    const end = renderTextNyan(30, 100);

    expect(visibleWidth(start)).toBe(30);
    expect(visibleWidth(middle)).toBe(30);
    expect(visibleWidth(end)).toBe(30);
    expect(plain(start).startsWith("(=^･ω･^=)")).toBe(true);
    expect(plain(middle)).toContain("━(=^･ω･^=)·");
    expect(plain(end).endsWith("(=^･ω･^=)")).toBe(true);
  });

  it("uses a rainbow bar when the runway is too narrow for the cat", () => {
    const runway = renderTextNyan(4.9, undefined);
    expect(visibleWidth(runway)).toBe(4);
    expect(plain(runway)).toBe("━━━━");
    expect(renderTextNyan(0)).toBe("");
    expect(renderTextNyan(-2)).toBe("");
  });
});
