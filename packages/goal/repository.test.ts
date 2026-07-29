import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

const root = join(import.meta.dirname, "../..");

describe("vendored Goal package", () => {
  it("registers its extension and skill from the root Pi manifest", () => {
    const manifest = readJson(join(root, "package.json"));
    const pi = field(manifest, "pi");
    expect(field(pi, "extensions")).toContain("./packages/goal/index.ts");
    expect(field(pi, "skills")).toContain("./packages/goal/skills");
  });

  it("keeps provenance and the upstream MIT license", () => {
    expect(existsSync(join(import.meta.dirname, "LICENSE"))).toBe(true);
    const provenance = readFileSync(join(import.meta.dirname, "UPSTREAM.md"), "utf8");
    expect(provenance).toContain("3f100be5434454d3388755a119d01caca9127c16");
    expect(provenance).toMatch(/\| License\s+\| MIT\s+\|/u);
  });
});
