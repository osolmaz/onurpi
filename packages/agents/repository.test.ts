import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { discoverSkills } from "./scripts/sync-skills.ts";

const packageRoot = import.meta.dirname;
const repositoryRoot = join(packageRoot, "..", "..");

function readJson(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected a JSON object in ${path}`);
  }
  return value as Record<string, unknown>;
}

describe("@onurpi/agents package", () => {
  it("registers only top-level personal skills", () => {
    const packageManifest = readJson(join(packageRoot, "package.json"));
    expect(packageManifest["private"]).toBe(true);
    expect(packageManifest["pi"]).toEqual({ skills: ["./skills/*/SKILL.md"] });

    const rootManifest = readJson(join(repositoryRoot, "package.json"));
    const pi = rootManifest["pi"];
    if (typeof pi !== "object" || pi === null || Array.isArray(pi)) {
      throw new Error("Expected a root Pi manifest");
    }
    expect((pi as { skills?: unknown }).skills).toEqual(
      expect.arrayContaining(["./packages/agents/skills/*/SKILL.md"]),
    );
  });

  it("contains the intended unique skills and excludes the removed alias", () => {
    const skills = discoverSkills(join(packageRoot, "skills"));
    expect(skills).toHaveLength(52);
    expect(new Set(skills.map((skill) => skill.skillId)).size).toBe(52);
    expect(skills.map((skill) => skill.skillId)).not.toContain("plain-language");
    expect(skills.map((skill) => skill.skillId)).toContain("amk");
  });

  it("keeps the sandbox skill as data without registering it at the package top level", () => {
    const sandboxSkill = join(
      packageRoot,
      "skills",
      "openclaw-onur-inventory",
      "sandbox",
      "SKILL.md",
    );
    expect(existsSync(sandboxSkill)).toBe(true);
    const topLevelSkillFiles = readdirSync(join(packageRoot, "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(packageRoot, "skills", entry.name, "SKILL.md"))
      .filter(existsSync);
    expect(topLevelSkillFiles).toHaveLength(52);
    expect(topLevelSkillFiles).not.toContain(sandboxSkill);
  });

  it("includes the refactored synchronization tools", () => {
    expect(existsSync(join(packageRoot, "scripts", "sync-skills.ts"))).toBe(true);
    expect(existsSync(join(packageRoot, "scripts", "sync-simpledoc-skill.ts"))).toBe(true);
  });
});
