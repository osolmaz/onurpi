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

import {
  discoverSkills,
  LEGACY_STATE_FILE_NAME,
  parseCli,
  parseSkillId,
  resolveSelection,
  runCli,
  STATE_FILE_NAME,
  syncSkills,
  type CopyDestination,
} from "./scripts/sync-skills.ts";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "onurpi-agents-"));
  temporaryDirectories.push(path);
  return path;
}

function write(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function createSkill(root: string, directory: string, name = directory): string {
  const path = join(root, directory);
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill ${name}.\n---\n\n# ${name}\n`,
    "utf8",
  );
  return path;
}

function legacyState(sourceRoot: string, ids: string[]): string {
  return `${JSON.stringify(
    { version: 1, source_root: sourceRoot, managed_skill_ids: ids },
    null,
    2,
  )}\n`;
}

function destination(root: string): CopyDestination {
  return {
    name: "Test harness",
    skillsRoot: join(root, "skills"),
    agentsDest: join(root, "AGENTS.md"),
    restartHint: "Restart test harness.",
  };
}

function readState(path: string): { managed_skill_ids?: unknown } {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof value !== "object" || value === null) throw new Error("Expected state object");
  return value;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { force: true, recursive: true });
});

describe("skill discovery", () => {
  it("rejects a missing source root but allows an existing empty source", () => {
    const root = temporaryDirectory();
    const empty = join(root, "empty");
    mkdirSync(empty);

    expect(discoverSkills(empty)).toEqual([]);
    expect(() => discoverSkills(join(root, "missing"))).toThrow(/Missing skill source root/u);
  });

  it("reads top-level skill names and rejects duplicate ids", () => {
    const root = temporaryDirectory();
    const skillsRoot = join(root, "skills");
    createSkill(skillsRoot, "first", "shared");
    createSkill(skillsRoot, "second", "shared");

    expect(() => discoverSkills(skillsRoot)).toThrow(/Duplicate skill id/u);
  });

  it("rejects invalid frontmatter and source symlinks", () => {
    const root = temporaryDirectory();
    const missingName = join(root, "missing-name");
    mkdirSync(missingName);
    writeFileSync(join(missingName, "SKILL.md"), "---\ndescription: Missing.\n---\n", "utf8");
    expect(() => parseSkillId(missingName)).toThrow(/Missing frontmatter name/u);

    const skillsRoot = join(root, "skills");
    const linked = createSkill(skillsRoot, "linked");
    writeFileSync(join(root, "target"), "target\n", "utf8");
    symlinkSync(join(root, "target"), join(linked, "link"));
    expect(() => discoverSkills(skillsRoot)).toThrow(/must not contain symlinks/u);

    const topLevelRoot = join(root, "top-level-skills");
    mkdirSync(topLevelRoot);
    const targetSkill = createSkill(join(root, "targets"), "target-skill");
    symlinkSync(targetSkill, join(topLevelRoot, "linked-skill"));
    expect(() => discoverSkills(topLevelRoot)).toThrow(/must not contain symlinks/u);
  });

  it("supports source names and skill ids as selectors", () => {
    const root = temporaryDirectory();
    const first = createSkill(root, "source-first", "first");
    const second = createSkill(root, "second");
    const skills = [
      { sourceName: "source-first", skillId: "first", sourcePath: first },
      { sourceName: "second", skillId: "second", sourcePath: second },
    ];

    expect(
      resolveSelection(skills, ["source-first", "first", "second"]).map((skill) => skill.skillId),
    ).toEqual(["first", "second"]);
    expect(() => resolveSelection(skills, ["missing"])).toThrow(/Unknown skill selector/u);
  });
});

describe("cross-harness synchronization", () => {
  it("migrates legacy state, prunes removed skills, and omits nested SKILL files", () => {
    const root = temporaryDirectory();
    const sourceRoot = join(root, "source", "skills");
    const alpha = createSkill(sourceRoot, "alpha");
    write(join(alpha, "helper.txt"), "helper\n");
    write(join(alpha, "sandbox", "SKILL.md"), "---\nname: sandbox\ndescription: Hidden.\n---\n");
    const agentsSource = join(root, "source", "AGENTS.md");
    write(agentsSource, "# Instructions\n");
    const target = destination(join(root, "target"));
    createSkill(target.skillsRoot, "plain-language");
    write(
      join(target.skillsRoot, LEGACY_STATE_FILE_NAME),
      legacyState(join(root, "tools", "agents", "skills"), ["alpha", "plain-language"]),
    );

    syncSkills({
      sourceRoot,
      agentsSource,
      destinations: [target],
      selectors: [],
      prune: true,
      dryRun: false,
      log: () => undefined,
    });

    expect(readFileSync(target.agentsDest, "utf8")).toBe("# Instructions\n");
    expect(readFileSync(join(target.skillsRoot, "alpha", "helper.txt"), "utf8")).toBe("helper\n");
    expect(existsSync(join(target.skillsRoot, "alpha", "sandbox", "SKILL.md"))).toBe(false);
    expect(existsSync(join(target.skillsRoot, "plain-language"))).toBe(false);
    expect(existsSync(join(target.skillsRoot, LEGACY_STATE_FILE_NAME))).toBe(false);
    expect(readState(join(target.skillsRoot, STATE_FILE_NAME)).managed_skill_ids).toEqual([
      "alpha",
    ]);
  });

  it("keeps unselected managed skills during a selective synchronization", () => {
    const root = temporaryDirectory();
    const sourceRoot = join(root, "source", "skills");
    createSkill(sourceRoot, "alpha");
    createSkill(sourceRoot, "beta");
    const agentsSource = join(root, "source", "AGENTS.md");
    write(agentsSource, "instructions\n");
    const target = destination(join(root, "target"));

    syncSkills({
      sourceRoot,
      agentsSource,
      destinations: [target],
      selectors: [],
      prune: true,
      dryRun: false,
      log: () => undefined,
    });
    write(join(target.skillsRoot, "beta", "local.txt"), "keep until selected or pruned\n");
    syncSkills({
      sourceRoot,
      agentsSource,
      destinations: [target],
      selectors: ["alpha"],
      prune: false,
      dryRun: false,
      log: () => undefined,
    });

    expect(existsSync(join(target.skillsRoot, "beta", "local.txt"))).toBe(true);
    expect(readState(join(target.skillsRoot, STATE_FILE_NAME)).managed_skill_ids).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("rejects a collision with a skill it does not manage", () => {
    const root = temporaryDirectory();
    const sourceRoot = join(root, "source", "skills");
    createSkill(sourceRoot, "alpha");
    const agentsSource = join(root, "source", "AGENTS.md");
    write(agentsSource, "instructions\n");
    const target = destination(join(root, "target"));
    createSkill(target.skillsRoot, "alpha");

    expect(() => {
      syncSkills({
        sourceRoot,
        agentsSource,
        destinations: [target],
        selectors: [],
        prune: true,
        dryRun: false,
        log: () => undefined,
      });
    }).toThrow(/Refusing to replace unowned skill/u);
    expect(readFileSync(join(target.skillsRoot, "alpha", "SKILL.md"), "utf8")).toContain(
      "Test skill alpha",
    );
    expect(existsSync(target.agentsDest)).toBe(false);
  });

  it("does not write during a dry run", () => {
    const root = temporaryDirectory();
    const sourceRoot = join(root, "source", "skills");
    createSkill(sourceRoot, "alpha");
    const agentsSource = join(root, "source", "AGENTS.md");
    write(agentsSource, "instructions\n");
    const target = destination(join(root, "target"));

    syncSkills({
      sourceRoot,
      agentsSource,
      destinations: [target],
      selectors: [],
      prune: true,
      dryRun: true,
      log: () => undefined,
    });

    expect(existsSync(target.agentsDest)).toBe(false);
    expect(existsSync(target.skillsRoot)).toBe(false);
  });
});

describe("command-line interface", () => {
  it("parses destination, selection, prune, and skip options", () => {
    const root = temporaryDirectory();
    const parsed = parseCli(
      [
        "--source-root",
        join(root, "source"),
        "--agents-source",
        join(root, "AGENTS.md"),
        "--dest",
        join(root, "codex"),
        "--claude-dest",
        join(root, "claude"),
        "--cursor-dest",
        join(root, "cursor"),
        "--cursor-agents-dest",
        join(root, "cursor-agents.md"),
        "--pi-dest",
        join(root, "pi"),
        "--skip-claude",
        "--prune",
        "--dry-run",
        "alpha",
      ],
      root,
    );

    expect(parsed).toMatchObject({
      selectors: ["alpha"],
      skipCodex: false,
      skipClaude: true,
      skipCursor: false,
      skipPi: false,
      prune: true,
      dryRun: true,
    });
    expect(() => parseCli(["--prune", "--no-prune"], root)).toThrow(/cannot be used together/u);
    expect(() => parseCli(["--unknown"], root)).toThrow(/Unknown option/u);
    expect(() => parseCli(["--dest"], root)).toThrow(/requires a value/u);
  });

  it("runs all destination adapters and rejects an empty destination set", () => {
    const root = temporaryDirectory();
    const sourceRoot = join(root, "source", "skills");
    createSkill(sourceRoot, "alpha");
    const agentsSource = join(root, "source", "AGENTS.md");
    write(agentsSource, "instructions\n");
    const codex = join(root, "codex", "skills");
    const claude = join(root, "claude", "skills");
    const cursor = join(root, "cursor", "skills");
    const cursorAgents = join(root, "cursor-workspace", "AGENTS.md");
    const pi = join(root, "pi", "skills");
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      runCli([
        "--source-root",
        sourceRoot,
        "--agents-source",
        agentsSource,
        "--dest",
        codex,
        "--claude-dest",
        claude,
        "--cursor-dest",
        cursor,
        "--cursor-agents-dest",
        cursorAgents,
        "--pi-dest",
        pi,
      ]);
      expect(existsSync(join(codex, "alpha", "SKILL.md"))).toBe(true);
      expect(existsSync(join(claude, "alpha", "SKILL.md"))).toBe(true);
      expect(existsSync(join(cursor, "alpha", "SKILL.md"))).toBe(true);
      expect(readFileSync(cursorAgents, "utf8")).toBe("instructions\n");
      expect(readFileSync(join(root, "pi", "AGENTS.md"), "utf8")).toBe("instructions\n");
      expect(existsSync(join(pi, "alpha"))).toBe(false);
      expect(() => {
        runCli(["--skip-codex", "--skip-claude", "--skip-cursor", "--skip-pi"]);
      }).toThrow(/every destination was skipped/u);
    } finally {
      consoleLog.mockRestore();
    }
  });
});

describe("Pi synchronization", () => {
  it("copies instructions, removes only managed legacy skills, and installs no skills", () => {
    const root = temporaryDirectory();
    const sourceRoot = join(root, "source", "skills");
    createSkill(sourceRoot, "alpha");
    const agentsSource = join(root, "source", "AGENTS.md");
    write(agentsSource, "Pi instructions\n");
    const configRoot = join(root, "pi");
    const skillsRoot = join(configRoot, "skills");
    createSkill(skillsRoot, "alpha");
    createSkill(skillsRoot, "unrelated");
    write(
      join(skillsRoot, LEGACY_STATE_FILE_NAME),
      legacyState(join(root, "tools", "agents", "skills"), ["alpha"]),
    );

    syncSkills({
      sourceRoot,
      agentsSource,
      destinations: [],
      piDestination: { configRoot, skillsRoot },
      selectors: [],
      prune: true,
      dryRun: false,
      log: () => undefined,
    });

    expect(readFileSync(join(configRoot, "AGENTS.md"), "utf8")).toBe("Pi instructions\n");
    expect(existsSync(join(skillsRoot, "alpha"))).toBe(false);
    expect(existsSync(join(skillsRoot, "unrelated", "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillsRoot, STATE_FILE_NAME))).toBe(false);
    expect(existsSync(join(skillsRoot, LEGACY_STATE_FILE_NAME))).toBe(false);
  });

  it("rejects legacy state from another source", () => {
    const root = temporaryDirectory();
    const sourceRoot = join(root, "source", "skills");
    createSkill(sourceRoot, "alpha");
    const agentsSource = join(root, "source", "AGENTS.md");
    write(agentsSource, "instructions\n");
    const configRoot = join(root, "pi");
    const skillsRoot = join(configRoot, "skills");
    write(
      join(skillsRoot, LEGACY_STATE_FILE_NAME),
      legacyState(join(root, "other", "skills"), ["alpha"]),
    );

    expect(() => {
      syncSkills({
        sourceRoot,
        agentsSource,
        destinations: [],
        piDestination: { configRoot, skillsRoot },
        selectors: [],
        prune: true,
        dryRun: false,
        log: () => undefined,
      });
    }).toThrow(/unknown source/u);
  });
});
