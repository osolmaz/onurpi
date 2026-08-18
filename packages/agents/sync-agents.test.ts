import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadSources, parseAgentCli, runAgentCli } from "./scripts/sync-agents.ts";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "onurpi-agents-sync-"));
  temporaryDirectories.push(path);
  return path;
}

function write(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function createSkill(root: string, name: string, body = name): void {
  write(
    join(root, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test ${name}.\n---\n\n# ${body}\n`,
  );
}

function syncArgs(root: string, privateRoot: string): string[] {
  return [
    "--private-root",
    privateRoot,
    "--source-root",
    join(root, "public", "skills"),
    "--dest",
    join(root, "installed", "codex", "skills"),
    "--claude-dest",
    join(root, "installed", "claude", "skills"),
    "--cursor-dest",
    join(root, "installed", "cursor", "skills"),
    "--cursor-agents-dest",
    join(root, "installed", "cursor", "AGENTS.md"),
    "--pi-dest",
    join(root, "installed", "pi", "skills"),
    "--shared-agents-dest",
    join(root, "installed", "agents", "AGENTS.md"),
    "--shared-skills-dest",
    join(root, "installed", "agents", "skills"),
  ];
}

function createSources(root: string): string {
  const privateRoot = join(root, "private");
  createSkill(join(root, "public", "skills"), "public-skill");
  write(join(privateRoot, "AGENTS.md"), "private instructions\n");
  createSkill(join(privateRoot, "skills"), "private-skill");
  return privateRoot;
}

function run(root: string, command: "check" | "sync", args: string[]): void {
  runAgentCli([command, ...args], join(root, "public"));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

describe("agent source selection", () => {
  it("requires a command and resolves the private source", () => {
    expect(() => parseAgentCli([])).toThrow(/first argument/u);
    vi.stubEnv("AGENTS_REPO", "/configured/private");
    expect(parseAgentCli(["check"]).privateRoot).toBe("/configured/private");
    expect(parseAgentCli(["sync", "--private-root", "/explicit/private"]).privateRoot).toBe(
      "/explicit/private",
    );
  });

  it("uses the private instruction file unchanged", () => {
    const root = temporaryDirectory();
    const privateRoot = createSources(root);
    const sources = loadSources(join(root, "public", "skills"), privateRoot);
    try {
      expect(sources.agentsSource).toBe(join(privateRoot, "AGENTS.md"));
      expect(readFileSync(sources.agentsSource, "utf8")).toBe("private instructions\n");
      expect(sources.publicSkills.map((skill) => skill.skillId)).toEqual(["public-skill"]);
      expect(sources.privateSkills.map((skill) => skill.skillId)).toEqual(["private-skill"]);
    } finally {
      rmSync(sources.temporaryRoot, { force: true, recursive: true });
    }
  });
});

describe("agent synchronization", () => {
  it("installs one exact instruction source and both skill sets", () => {
    const root = temporaryDirectory();
    const privateRoot = createSources(root);
    const args = syncArgs(root, privateRoot);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    run(root, "sync", args);
    run(root, "check", args);

    for (const path of [
      join(root, "installed", "codex", "AGENTS.md"),
      join(root, "installed", "claude", "CLAUDE.md"),
      join(root, "installed", "cursor", "AGENTS.md"),
      join(root, "installed", "pi", "AGENTS.md"),
      join(root, "installed", "agents", "AGENTS.md"),
    ]) {
      expect(readFileSync(path, "utf8")).toBe("private instructions\n");
    }
    for (const harness of ["codex", "claude", "cursor"]) {
      expect(existsSync(join(root, "installed", harness, "skills", "public-skill"))).toBe(true);
      expect(existsSync(join(root, "installed", harness, "skills", "private-skill"))).toBe(true);
    }
    expect(existsSync(join(root, "installed", "agents", "skills", "private-skill"))).toBe(true);
    expect(existsSync(join(root, "installed", "agents", "skills", "public-skill"))).toBe(false);
    expect(existsSync(join(root, "installed", "pi", "skills", "public-skill"))).toBe(false);
  });

  it("detects drift and repairs it", () => {
    const root = temporaryDirectory();
    const privateRoot = createSources(root);
    const args = syncArgs(root, privateRoot);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    run(root, "sync", args);
    write(join(root, "installed", "agents", "skills", "private-skill", "SKILL.md"), "damaged\n");
    expect(() => {
      run(root, "check", args);
    }).toThrow(/differs from source/u);
    run(root, "sync", args);
    expect(() => {
      run(root, "check", args);
    }).not.toThrow();
  });

  it("rejects duplicate skill names before writing", () => {
    const root = temporaryDirectory();
    const privateRoot = createSources(root);
    createSkill(join(privateRoot, "skills"), "public-skill");
    expect(() => {
      run(root, "sync", syncArgs(root, privateRoot));
    }).toThrow(/exists in both public and private/u);
    expect(existsSync(join(root, "installed"))).toBe(false);
  });

  it("fails before writing when the private source is missing", () => {
    const root = temporaryDirectory();
    mkdirSync(join(root, "public", "skills"), { recursive: true });
    expect(() => {
      run(root, "sync", syncArgs(root, join(root, "missing")));
    }).toThrow(/Missing instruction source/u);
    expect(existsSync(join(root, "installed"))).toBe(false);
  });

  it("rejects the removed public-only mode", () => {
    const root = temporaryDirectory();
    const privateRoot = createSources(root);
    expect(() => {
      run(root, "sync", ["--public-only", ...syncArgs(root, privateRoot)]);
    }).toThrow(/Unknown option/u);
    expect(existsSync(join(root, "installed"))).toBe(false);
  });

  it("preflights every destination before changing one", () => {
    const root = temporaryDirectory();
    const privateRoot = createSources(root);
    const args = syncArgs(root, privateRoot);
    const collision = join(root, "installed", "cursor", "skills", "public-skill");
    write(join(collision, "SKILL.md"), "unowned\n");
    expect(() => {
      run(root, "sync", args);
    }).toThrow(/unowned skill/u);
    expect(existsSync(join(root, "installed", "codex"))).toBe(false);
    expect(readFileSync(join(collision, "SKILL.md"), "utf8")).toBe("unowned\n");
  });

  it("preflights without writing during a dry run", () => {
    const root = temporaryDirectory();
    const privateRoot = createSources(root);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    run(root, "sync", ["--dry-run", ...syncArgs(root, privateRoot)]);
    expect(existsSync(join(root, "installed"))).toBe(false);
  });

  it("can skip Pi", () => {
    const root = temporaryDirectory();
    const privateRoot = createSources(root);
    const args = ["--skip-pi", ...syncArgs(root, privateRoot)];
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    run(root, "sync", args);
    run(root, "check", args);
    expect(existsSync(join(root, "installed", "codex", "AGENTS.md"))).toBe(true);
    expect(existsSync(join(root, "installed", "pi"))).toBe(false);
    expect(existsSync(join(root, "installed", "agents"))).toBe(false);
  });

  it("rejects a linked private instruction source", () => {
    const root = temporaryDirectory();
    mkdirSync(join(root, "public", "skills"), { recursive: true });
    const privateRoot = join(root, "private");
    mkdirSync(join(privateRoot, "skills"), { recursive: true });
    write(join(root, "private-target.md"), "private\n");
    symlinkSync(join(root, "private-target.md"), join(privateRoot, "AGENTS.md"));
    expect(() => {
      run(root, "sync", syncArgs(root, privateRoot));
    }).toThrow(/regular file/u);
    expect(existsSync(join(root, "installed"))).toBe(false);
  });
});
