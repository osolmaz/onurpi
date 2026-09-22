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

  it("exposes the pinned skills except the hidden workflow entry points", () => {
    const skills = manifest.pi?.skills ?? [];
    const root = "../../node_modules/@osolmaz/pi-workflows/skills";
    expect(skills[0]).toBe(root);

    const hidden = [
      "autodoc",
      "autoimplement",
      "autoplan",
      "monitor",
      "pi-workflows",
      "sanity-check",
    ];
    for (const name of hidden) {
      expect(skills).toContain(`!${root}/${name}`);
      expect(fs.existsSync(path.join(packageDir, root, name, "SKILL.md"))).toBe(true);
    }
  });
});
