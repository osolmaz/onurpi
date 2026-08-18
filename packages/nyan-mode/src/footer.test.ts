import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { renderFooterLine, type FooterTheme } from "../index.ts";
import { createTextNyanPainter, type NyanRunwayPainter } from "./index.ts";

const ESCAPE = String.fromCharCode(27);
const ANSI = new RegExp(`${ESCAPE}\\[[0-?]*[ -/]*[@-~]`, "gu");
const testTheme: FooterTheme = {
  fg(_color, text) {
    return text;
  },
};

function plain(text: string): string {
  return text.replace(ANSI, "");
}

function bitmapPainter(): NyanRunwayPainter {
  return {
    clear: vi.fn(),
    debugInfo: () => "test",
    dispose: vi.fn(),
    render: vi.fn(() => undefined),
  };
}

describe("Nyan footer context display", () => {
  it("puts remaining context directly after a stressed cat", () => {
    const textPainter = createTextNyanPainter(vi.fn(), 0);
    const line = renderFooterLine({
      bitmapPainter: bitmapPainter(),
      branch: "feature",
      cumulativeCost: 0,
      displayMode: "text",
      enabled: true,
      modelId: "gpt-5.6-sol",
      presentation: { contextStress: "stressed", mood: "annoyed" },
      project: "onurpi",
      reasoning: true,
      textPainter,
      theme: testTheme,
      thinkingLevel: "high",
      usedPercent: 90,
      usageStatus: "codex 0% wk",
      usingSubscription: true,
      width: 120,
    });

    expect(plain(line)).toMatch(/!\(=¬_¬=\)\s+10%/u);
    expect(plain(line)).toContain("$0.000 (sub) codex 0% wk");
    expect(plain(line)).not.toContain("90%");
    expect(plain(line)).not.toContain("128k");
    expect(visibleWidth(line)).toBe(120);
  });
});

describe("Nyan footer identity display", () => {
  it("leads with the model and thinking level before the project", () => {
    const line = plain(
      renderFooterLine({
        bitmapPainter: bitmapPainter(),
        branch: "feature",
        cumulativeCost: 0,
        displayMode: "text",
        enabled: true,
        modelId: "gpt-5.6-sol",
        presentation: { contextStress: "none", mood: "neutral" },
        project: "onurpi",
        reasoning: true,
        textPainter: createTextNyanPainter(vi.fn(), 0),
        theme: testTheme,
        thinkingLevel: "high",
        usedPercent: 90,
        usageStatus: undefined,
        usingSubscription: true,
        width: 120,
      }),
    );

    expect(line.startsWith("∮ gpt5.6-sol (high) onurpi")).toBe(true);
    expect(line.indexOf("gpt5.6-sol")).toBe(line.lastIndexOf("gpt5.6-sol"));
    expect(line).not.toContain("think high");
  });

  it("keeps unknown usage compact and width-bounded", () => {
    const line = renderFooterLine({
      bitmapPainter: bitmapPainter(),
      branch: null,
      cumulativeCost: 0,
      displayMode: "text",
      enabled: true,
      modelId: undefined,
      presentation: { contextStress: "none", mood: "neutral" },
      project: "onurpi",
      reasoning: undefined,
      textPainter: createTextNyanPainter(vi.fn(), 0),
      theme: testTheme,
      thinkingLevel: "off",
      usedPercent: undefined,
      usageStatus: undefined,
      usingSubscription: false,
      width: 40,
    });

    expect(plain(line)).toMatch(/\(=\^･ω･\^=\)\s+\?/u);
    expect(visibleWidth(line)).toBeLessThanOrEqual(40);
  });

  it("omits the thinking level when the model does not reason", () => {
    const line = plain(
      renderFooterLine({
        bitmapPainter: bitmapPainter(),
        branch: null,
        cumulativeCost: 0,
        displayMode: "text",
        enabled: true,
        modelId: undefined,
        presentation: { contextStress: "none", mood: "neutral" },
        project: "onurpi",
        reasoning: undefined,
        textPainter: createTextNyanPainter(vi.fn(), 0),
        theme: testTheme,
        thinkingLevel: "off",
        usedPercent: undefined,
        usageStatus: undefined,
        usingSubscription: false,
        width: 120,
      }),
    );

    expect(line.startsWith("∮ no-model onurpi")).toBe(true);
    expect(line).not.toContain("(off)");
  });
});
