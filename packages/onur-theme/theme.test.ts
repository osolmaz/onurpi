import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const themePath = join(packageRoot, "themes", "onur-dark.json");
const requiredColors = [
  "accent",
  "border",
  "borderAccent",
  "borderMuted",
  "success",
  "error",
  "warning",
  "muted",
  "dim",
  "text",
  "thinkingText",
  "selectedBg",
  "userMessageBg",
  "userMessageText",
  "customMessageBg",
  "customMessageText",
  "customMessageLabel",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
  "toolTitle",
  "toolOutput",
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdCodeBlock",
  "mdCodeBlockBorder",
  "mdQuote",
  "mdQuoteBorder",
  "mdHr",
  "mdListBullet",
  "toolDiffAdded",
  "toolDiffRemoved",
  "toolDiffContext",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
  "thinkingMax",
  "bashMode",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function expectValidColor(color: unknown, variables: Record<string, unknown>): void {
  expect(typeof color === "string" || Number.isInteger(color)).toBe(true);
  if (typeof color === "string" && color !== "" && !color.startsWith("#")) {
    expect(Object.hasOwn(variables, color)).toBe(true);
  }
}

describe("onur-dark theme package", () => {
  it("declares the theme in both package manifests", () => {
    const packageManifest = readJson(join(packageRoot, "package.json"));
    const rootManifest = readJson(resolve(packageRoot, "..", "..", "package.json"));

    expect(packageManifest).toMatchObject({
      name: "@onurpi/theme",
      pi: { themes: ["./themes/onur-dark.json"] },
    });
    expect(rootManifest).toMatchObject({
      pi: { themes: ["./packages/onur-theme/themes/onur-dark.json"] },
    });
  });

  it("defines every Pi color with valid variable references", () => {
    const theme = readJson(themePath);
    expect(isRecord(theme)).toBe(true);
    if (!isRecord(theme)) return;

    const colors = theme["colors"];
    const variables = theme["vars"];
    expect(theme["name"]).toBe("onur-dark");
    expect(isRecord(colors)).toBe(true);
    expect(isRecord(variables)).toBe(true);
    if (!isRecord(colors) || !isRecord(variables)) return;

    expect(Object.keys(colors).sort()).toEqual([...requiredColors].sort());
    for (const color of Object.values(colors)) expectValidColor(color, variables);
  });
});
