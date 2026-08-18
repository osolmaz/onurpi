import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import extension from "./index.ts";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")) as {
  pi?: { skills?: string[] };
};

describe("Pi Workflows wrapper", () => {
  it("exports the pinned extension factory", () => {
    expect(extension).toBeTypeOf("function");
  });

  it("exposes both skills from the pinned dependency", () => {
    expect(manifest.pi?.skills).toEqual(["../../node_modules/@osolmaz/pi-workflows/skills"]);

    const skillsPath = manifest.pi?.skills?.[0];
    if (skillsPath === undefined) throw new Error("Pi Workflows skill path is missing.");
    const skillsDir = path.resolve(packageDir, skillsPath);
    expect(fs.existsSync(path.join(skillsDir, "monitor", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, "pi-workflows", "SKILL.md"))).toBe(true);
  });
});
