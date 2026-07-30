import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

function readJson(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(join(root, path), "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object");
  }
  return value as Record<string, unknown>;
}

const extensions = [
  {
    name: "pi-demo-mode",
    source:
      "https://codeload.github.com/osolmaz/pi-demo-mode/tar.gz/8f18a3802a786be797404eb0a4ee3cce8a522b75",
    entry: "./node_modules/pi-demo-mode/extensions/demo-mode.ts",
  },
  {
    name: "pi-huggingface-oauth",
    source: "0.1.1",
    entry: "./node_modules/pi-huggingface-oauth/index.ts",
  },
  {
    name: "pi-must-win",
    source: "0.2.0",
    entry: "./node_modules/pi-must-win/index.ts",
  },
  {
    name: "pi-regraft",
    source: "0.3.0",
    entry: "./node_modules/pi-regraft/extensions/regraft.ts",
  },
  {
    name: "pi-workflows",
    source:
      "https://codeload.github.com/osolmaz/pi-workflows/tar.gz/630622e44fcd486690b6bcb923b4d18dc516723e",
    entry: "./node_modules/pi-workflows/src/extension/index.ts",
  },
] as const;

const packages = extensions;

describe("bundled extension dependencies", () => {
  it("pins and bundles every external extension", () => {
    const manifest = readJson("package.json");
    const dependencies = manifest["dependencies"];
    const bundled = manifest["bundledDependencies"];

    expect(dependencies).toEqual(
      Object.fromEntries(packages.map((dependency) => [dependency.name, dependency.source])),
    );
    expect(bundled).toEqual(packages.map((dependency) => dependency.name));
  });

  it("registers installed extension entry points", () => {
    const manifest = readJson("package.json");
    const pi = manifest["pi"];
    if (typeof pi !== "object" || pi === null || Array.isArray(pi))
      throw new Error("Expected a Pi manifest");
    const registered = (pi as { extensions?: unknown }).extensions;

    for (const extension of extensions) {
      expect(registered).toContain(extension.entry);
      expect(existsSync(join(root, extension.entry))).toBe(true);
    }
  });

  it("registers the optional Regrafter driver skill", () => {
    const manifest = readJson("package.json");
    const pi = manifest["pi"];
    if (typeof pi !== "object" || pi === null || Array.isArray(pi))
      throw new Error("Expected a Pi manifest");
    const skills = (pi as { skills?: unknown }).skills;

    expect(skills).toContain("./packages/regrafter-driver/skills");
    expect(existsSync(join(root, "node_modules", ".bin", "regrafter"))).toBe(true);
  });

  it("removes separate settings entries for bundled extensions", () => {
    const settings = readJson("settings.json");
    const packages = settings["packages"];
    expect(packages).not.toEqual(
      expect.arrayContaining([
        "git:github.com/Michaelliv/pi-goal@3f100be5434454d3388755a119d01caca9127c16",
        "npm:pi-goal",
        "npm:pi-huggingface-oauth@0.1.1",
        "git:github.com/osolmaz/pi-workflows",
        "git:github.com/osolmaz/pi-must-win",
        "npm:pi-must-win",
        "npm:pi-regraft@0.1.0",
        "npm:pi-regraft@0.2.0",
        "npm:pi-regraft@0.3.0",
      ]),
    );
  });
});
