import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mergeInstructions,
  parseComposedCli,
  runComposedCli,
} from "./scripts/sync-composed-agents.ts";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "onurpi-composed-agents-"));
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

function composedArgs(root: string, privateRoot: string): string[] {
  return [
    "--private-root",
    privateRoot,
    "--source-root",
    join(root, "public", "skills"),
    "--agents-source",
    join(root, "public", "AGENTS.md"),
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { force: true, recursive: true });
});

describe("instruction composition", () => {
  it("creates one deterministic file with public instructions first", () => {
    expect(mergeInstructions("# Public\n\n", "# Private\n")).toBe("# Public\n\n# Private\n");
    expect(mergeInstructions("# Public")).toBe("# Public\n");
  });

  it("requires an explicit command and rejects conflicting source modes", () => {
    expect(() => parseComposedCli([])).toThrow(/first argument/u);
    expect(() => parseComposedCli(["sync", "--public-only", "--private-root", "/private"])).toThrow(
      /cannot be used together/u,
    );
  });

  it("uses the configured private repository path", () => {
    vi.stubEnv("AGENTS_PRIVATE_REPO", "~/configured-private");
    expect(parseComposedCli(["check"]).privateRoot).toBe(join(homedir(), "configured-private"));
  });
});

describe("public and private synchronization", () => {
  it("installs one merged instruction file and the correct skill sets", () => {
    const root = temporaryDirectory();
    const privateRoot = join(root, "private");
    write(join(root, "public", "AGENTS.md"), "# Public\n");
    createSkill(join(root, "public", "skills"), "public-skill");
    write(join(privateRoot, "AGENTS.md"), "# Private\n");
    createSkill(join(privateRoot, "skills"), "private-skill");
    const args = composedArgs(root, privateRoot);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    runComposedCli(["sync", ...args], join(root, "public"));
    runComposedCli(["sync", ...args], join(root, "public"));
    runComposedCli(["check", ...args], join(root, "public"));

    const expected = "# Public\n\n# Private\n";
    for (const path of [
      join(root, "installed", "codex", "AGENTS.md"),
      join(root, "installed", "claude", "CLAUDE.md"),
      join(root, "installed", "cursor", "AGENTS.md"),
      join(root, "installed", "pi", "AGENTS.md"),
      join(root, "installed", "agents", "AGENTS.md"),
    ]) {
      expect(readFileSync(path, "utf8")).toBe(expected);
    }
    for (const harness of ["codex", "claude", "cursor"]) {
      expect(
        existsSync(join(root, "installed", harness, "skills", "public-skill", "SKILL.md")),
      ).toBe(true);
      expect(
        existsSync(join(root, "installed", harness, "skills", "private-skill", "SKILL.md")),
      ).toBe(true);
    }
    expect(
      existsSync(join(root, "installed", "agents", "skills", "private-skill", "SKILL.md")),
    ).toBe(true);
    expect(existsSync(join(root, "installed", "agents", "skills", "public-skill"))).toBe(false);
    expect(existsSync(join(root, "installed", "pi", "skills", "public-skill"))).toBe(false);
  });
});

describe("composed synchronization safety", () => {
  it("detects drift and repairs it on the next synchronization", () => {
    const root = temporaryDirectory();
    const privateRoot = join(root, "private");
    write(join(root, "public", "AGENTS.md"), "public\n");
    createSkill(join(root, "public", "skills"), "public-skill");
    write(join(privateRoot, "AGENTS.md"), "private\n");
    createSkill(join(privateRoot, "skills"), "private-skill");
    const args = composedArgs(root, privateRoot);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    runComposedCli(["sync", ...args], join(root, "public"));
    write(join(root, "installed", "agents", "skills", "private-skill", "SKILL.md"), "damaged\n");
    expect(() => {
      runComposedCli(["check", ...args], join(root, "public"));
    }).toThrow(/differs from source/u);
    runComposedCli(["sync", ...args], join(root, "public"));
    expect(() => {
      runComposedCli(["check", ...args], join(root, "public"));
    }).not.toThrow();
  });

  it("rejects duplicate public and private skill names before writing", () => {
    const root = temporaryDirectory();
    const privateRoot = join(root, "private");
    write(join(root, "public", "AGENTS.md"), "public\n");
    createSkill(join(root, "public", "skills"), "duplicate");
    write(join(privateRoot, "AGENTS.md"), "private\n");
    createSkill(join(privateRoot, "skills"), "duplicate");
    const args = composedArgs(root, privateRoot);

    expect(() => {
      runComposedCli(["sync", ...args], join(root, "public"));
    }).toThrow(/exists in both public and private/u);
    expect(existsSync(join(root, "installed"))).toBe(false);
  });

  it("fails before writing when the private repository is missing", () => {
    const root = temporaryDirectory();
    write(join(root, "public", "AGENTS.md"), "public\n");
    mkdirSync(join(root, "public", "skills"), { recursive: true });
    const args = composedArgs(root, join(root, "missing-private"));

    expect(() => {
      runComposedCli(["sync", ...args], join(root, "public"));
    }).toThrow(/Missing instruction source/u);
    expect(existsSync(join(root, "installed"))).toBe(false);
  });

  it("supports an explicit public-only installation", () => {
    const root = temporaryDirectory();
    write(join(root, "public", "AGENTS.md"), "public\n");
    createSkill(join(root, "public", "skills"), "public-skill");
    const args = composedArgs(root, join(root, "unused-private"));
    const privateIndex = args.indexOf("--private-root");
    args.splice(privateIndex, 2, "--public-only");
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    runComposedCli(["sync", ...args], join(root, "public"));
    runComposedCli(["check", ...args], join(root, "public"));

    expect(readFileSync(join(root, "installed", "pi", "AGENTS.md"), "utf8")).toBe("public\n");
  });
});

describe("composed synchronization options", () => {
  it("preflights without writing during a dry run", () => {
    const root = temporaryDirectory();
    const privateRoot = join(root, "private");
    write(join(root, "public", "AGENTS.md"), "public\n");
    createSkill(join(root, "public", "skills"), "public-skill");
    write(join(privateRoot, "AGENTS.md"), "private\n");
    createSkill(join(privateRoot, "skills"), "private-skill");
    const args = composedArgs(root, privateRoot);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    runComposedCli(["sync", "--dry-run", ...args], join(root, "public"));

    expect(existsSync(join(root, "installed"))).toBe(false);
  });

  it("can skip Pi while installing the other harnesses", () => {
    const root = temporaryDirectory();
    const privateRoot = join(root, "private");
    write(join(root, "public", "AGENTS.md"), "public\n");
    createSkill(join(root, "public", "skills"), "public-skill");
    write(join(privateRoot, "AGENTS.md"), "private\n");
    createSkill(join(privateRoot, "skills"), "private-skill");
    const args = composedArgs(root, privateRoot);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    runComposedCli(["sync", "--skip-pi", ...args], join(root, "public"));
    runComposedCli(["check", "--skip-pi", ...args], join(root, "public"));

    expect(existsSync(join(root, "installed", "codex", "AGENTS.md"))).toBe(true);
    expect(existsSync(join(root, "installed", "pi"))).toBe(false);
    expect(existsSync(join(root, "installed", "agents"))).toBe(false);
  });

  it("rejects a linked private instruction source", () => {
    const root = temporaryDirectory();
    const privateRoot = join(root, "private");
    write(join(root, "public", "AGENTS.md"), "public\n");
    mkdirSync(join(root, "public", "skills"), { recursive: true });
    write(join(root, "private-target.md"), "private\n");
    mkdirSync(join(privateRoot, "skills"), { recursive: true });
    symlinkSync(join(root, "private-target.md"), join(privateRoot, "AGENTS.md"));
    const args = composedArgs(root, privateRoot);

    expect(() => {
      runComposedCli(["sync", ...args], join(root, "public"));
    }).toThrow(/regular file/u);
    expect(existsSync(join(root, "installed"))).toBe(false);
  });
});
