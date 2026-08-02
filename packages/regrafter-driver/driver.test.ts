import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import extension from "./index.ts";

const root = import.meta.dirname;
const skill = readFileSync(join(root, "skills", "regrafter", "SKILL.md"), "utf8");

it("exports the pinned Regraft extension factory", () => {
  expect(extension).toBeTypeOf("function");
});

it("keeps delegation explicit and preserves repository ownership", () => {
  expect(skill).toContain("user explicitly asks");
  expect(skill).toContain("target worktree as read-only");
  expect(skill).toContain("Silence does not approve");
  expect(skill).toContain("same run id");
  expect(skill).toContain("Abort does not reset files");
  expect(skill).toContain("baseline grants no overlay commits");
  expect(skill).not.toContain("--allow commits --json");
});

it("uses only the Regrafter controller surface", () => {
  for (const command of ["start", "send", "list", "inspect", "attach", "abort"]) {
    expect(skill).toContain(`<driver> ${command}`);
  }
  expect(skill).not.toContain("regraft update");
  expect(skill).not.toContain("regrafter_report");
});

it("runs the bundled controller without a global executable", () => {
  const driver = join(root, "skills", "regrafter", "scripts", "regrafter.mjs");
  const output = execFileSync(process.execPath, [driver, "--help"], { encoding: "utf8" });

  expect(output).toContain("regrafter start");
});
