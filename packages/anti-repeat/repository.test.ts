import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = import.meta.dirname;
const repositoryRoot = join(packageRoot, "..", "..");

function readJson(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected an object in ${path}`);
  }
  return value as Record<string, unknown>;
}

describe("Anti-Repeat package registration", () => {
  it("registers the extension from the root Pi manifest and tracked settings", () => {
    const manifest = readJson(join(repositoryRoot, "package.json"));
    const pi = manifest["pi"];
    if (typeof pi !== "object" || pi === null || Array.isArray(pi)) {
      throw new Error("Expected a Pi manifest");
    }
    expect((pi as { extensions?: unknown }).extensions).toEqual(
      expect.arrayContaining(["./packages/anti-repeat/index.ts"]),
    );

    const settings = readJson(join(repositoryRoot, "settings.json"));
    expect(settings["packages"]).toEqual(
      expect.arrayContaining(["../../repos/onurpi/packages/anti-repeat"]),
    );
    expect(existsSync(join(packageRoot, "index.ts"))).toBe(true);
  });

  it("runs package checks in normal CI and keeps mutation testing manual", () => {
    const ci = readFileSync(join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
    expect(ci).toContain("Check @onurpi/anti-repeat package");
    expect(ci).toContain("working-directory: packages/anti-repeat");
    expect(ci).toContain("Mutate @onurpi/anti-repeat package");
    expect(ci).toContain("if: github.event_name == 'workflow_dispatch'");
  });
});
