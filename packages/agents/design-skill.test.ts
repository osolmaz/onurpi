import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { discoverSkills } from "./scripts/sync-skills.ts";

const root = join(import.meta.dirname, "skills", "design");

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

function content(relative: string): string {
  return readFileSync(join(root, relative), "utf8");
}

describe("design skill", () => {
  it("has one concise entrypoint and ordinary references", () => {
    const source = content("SKILL.md");
    expect(source.startsWith("---\n")).toBe(true);
    expect(source).toContain("name: design\ndescription: >-");
    const description = source.split("description: >-\n")[1]?.split("\n---")[0];
    expect(description).toBeDefined();
    expect(description?.length).toBeLessThanOrEqual(1024);
    expect(source.split("\n").length).toBeLessThanOrEqual(80);
    expect(files(root).filter((file) => file.endsWith("/SKILL.md"))).toEqual([
      join(root, "SKILL.md"),
    ]);
    for (const file of files(join(root, "references"))) {
      expect(readFileSync(file, "utf8")).not.toMatch(/^---/u);
    }
    expect(
      discoverSkills(join(root, "..")).filter((skill) => skill.skillId === "design"),
    ).toHaveLength(1);
  });

  it("resolves local Markdown links after relocation", () => {
    for (const file of files(root).filter((path) => path.endsWith(".md"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\]\(([^)]+)\)/gu)) {
        const target = match[1];
        if (target === undefined || target.startsWith("https://")) continue;
        expect(existsSync(resolve(dirname(file), target)), `${file}: ${target}`).toBe(true);
      }
    }
  });

  it("routes each medium and excludes nonvisual design tasks", () => {
    const source = content("SKILL.md");
    for (const domain of ["WEB_UI", "GRAPHS_FIGURES", "VIDEO_EDITING", "DEMO_VIDEO", "THREE_D"]) {
      expect(source).toContain(`references/${domain}.md`);
    }
    for (const excluded of ["ordinary", "prose editing", "backend work", "software architecture"]) {
      expect(source).toContain(excluded);
    }
    expect(source).toContain("A speed change does not authorize restyling the footage");
    expect(content("agents/openai.yaml")).toContain("Use $design");
  });

  it("keeps the shared colors aligned with the chart example", () => {
    const theme = content("references/THEME.md");
    const example = content("examples/graphs-figures/render_comparison_chart.py");
    for (const color of ["#000000", "#F5F0E6", "#F5F5F5", "#111111", "#BDBDBD", "#4A4A4A"]) {
      expect(theme).toContain(color);
      expect(example).toContain(color);
    }
    expect(example).toContain('default="dark"');
    expect(example).not.toContain("best = max");
    expect(theme).toContain("Inter from Google Fonts");
    expect(theme).toContain("Yodel Grotesk");
    expect(theme).toContain("Helvetica");
  });

  it("retains evidence, delivery, and visual-review requirements", () => {
    const demo = content("references/DEMO_VIDEO.md");
    for (const requirement of [
      "immutable records",
      "validity rule",
      "fixed columns",
      "license text",
      "document.fonts.load",
      "SHA-256",
      "Tailscale",
      "contact sheet",
      "practical-significance",
    ]) {
      expect(demo).toContain(requirement);
    }
    expect(content("references/THREE_D.md")).toContain("3d/QUALITY_REVIEW.md");
    expect(content("references/THREE_D.md")).toContain("3d/INTERACTIVE_DELIVERY.md");
    expect(content("references/3d/QUALITY_REVIEW.md")).toContain("same view");
    expect(content("references/3d/INTERACTIVE_DELIVERY.md")).toContain("clean start");
    for (const relative of [
      "scripts/demo-video/render.mjs",
      "examples/graphs-figures/render_comparison_chart.py",
    ]) {
      expect(existsSync(join(root, relative))).toBe(true);
    }
  });
});
