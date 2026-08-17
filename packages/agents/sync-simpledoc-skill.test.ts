import {
  chmodSync,
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
import { afterEach, describe, expect, it } from "vitest";

import {
  describeDrift,
  fileManifest,
  parseSimpleDocCli,
  runSimpleDocCli,
  syncSimpleDocSkill,
  validateSimpleDocSkill,
} from "./scripts/sync-simpledoc-skill.ts";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "onurpi-simpledoc-"));
  temporaryDirectories.push(path);
  return path;
}

function createSimpleDocSkill(root: string, body = "# SimpleDoc\n"): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "SKILL.md"),
    `---\nname: simpledoc\ndescription: Test SimpleDoc skill.\n---\n\n${body}`,
    "utf8",
  );
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { force: true, recursive: true });
});

describe("SimpleDoc command-line interface", () => {
  it("parses explicit paths and modes", () => {
    const root = temporaryDirectory();
    expect(
      parseSimpleDocCli(
        ["--source", join(root, "source"), "--destination", join(root, "destination"), "--check"],
        root,
      ),
    ).toEqual({
      source: join(root, "source"),
      destination: join(root, "destination"),
      check: true,
      dryRun: false,
    });
    expect(() => parseSimpleDocCli(["--check", "--dry-run"], root)).toThrow(
      /cannot be used together/u,
    );
    expect(() => parseSimpleDocCli(["--source"], root)).toThrow(/requires a value/u);
    expect(() => parseSimpleDocCli(["unknown"], root)).toThrow(/Unknown argument/u);
  });

  it("returns the synchronization exit code", () => {
    const root = temporaryDirectory();
    const source = join(root, "source");
    const destination = join(root, "destination");
    createSimpleDocSkill(source);
    createSimpleDocSkill(destination);

    expect(runSimpleDocCli(["--source", source, "--destination", destination, "--check"])).toBe(0);
    createSimpleDocSkill(destination, "# Old\n");
    expect(runSimpleDocCli(["--source", source, "--destination", destination, "--check"])).toBe(1);
  });
});

describe("SimpleDoc skill synchronization", () => {
  it("copies changed files and preserves executable modes", () => {
    const root = temporaryDirectory();
    const source = join(root, "source");
    const destination = join(root, "destination");
    createSimpleDocSkill(source);
    mkdirSync(join(source, "scripts"));
    const executable = join(source, "scripts", "check.sh");
    writeFileSync(executable, "#!/bin/sh\n", "utf8");
    chmodSync(executable, 0o755);
    createSimpleDocSkill(destination, "# Old\n");

    const result = syncSimpleDocSkill({
      source,
      destination,
      check: false,
      dryRun: false,
      log: () => undefined,
    });

    expect(result.changed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(destination, "SKILL.md"), "utf8")).toContain("# SimpleDoc");
    expect(fileManifest(destination).get("scripts/check.sh")?.mode).toBe(0o755);
  });

  it("reports drift without writing in check and dry-run modes", () => {
    const root = temporaryDirectory();
    const source = join(root, "source");
    const destination = join(root, "destination");
    createSimpleDocSkill(source);
    createSimpleDocSkill(destination, "# Old\n");

    const checked = syncSimpleDocSkill({
      source,
      destination,
      check: true,
      dryRun: false,
      log: () => undefined,
    });
    const dryRun = syncSimpleDocSkill({
      source,
      destination,
      check: false,
      dryRun: true,
      log: () => undefined,
    });

    expect(checked.exitCode).toBe(1);
    expect(dryRun.exitCode).toBe(0);
    expect(checked.changed).toBe(false);
    expect(dryRun.changed).toBe(false);
    expect(readFileSync(join(destination, "SKILL.md"), "utf8")).toContain("# Old");
  });

  it("reports no change for matching trees", () => {
    const root = temporaryDirectory();
    const source = join(root, "source");
    const destination = join(root, "destination");
    createSimpleDocSkill(source);
    createSimpleDocSkill(destination);

    const result = syncSimpleDocSkill({
      source,
      destination,
      check: false,
      dryRun: false,
      log: () => undefined,
    });

    expect(result).toEqual({ changed: false, exitCode: 0, drift: [] });
    expect(describeDrift(fileManifest(source), fileManifest(destination))).toEqual([]);
  });

  it("rejects invalid frontmatter, same-path copies, and symlinks", () => {
    const root = temporaryDirectory();
    const invalid = join(root, "invalid");
    mkdirSync(invalid);
    writeFileSync(join(invalid, "SKILL.md"), "---\nname: other\n---\n", "utf8");
    expect(() => {
      validateSimpleDocSkill(invalid);
    }).toThrow(/frontmatter name/u);

    const source = join(root, "source");
    createSimpleDocSkill(source);
    expect(() =>
      syncSimpleDocSkill({
        source,
        destination: source,
        check: false,
        dryRun: false,
      }),
    ).toThrow(/non-overlapping/u);

    const linkedSource = join(root, "linked-source");
    symlinkSync(source, linkedSource, "dir");
    expect(() =>
      syncSimpleDocSkill({
        source: linkedSource,
        destination: join(root, "linked-destination"),
        check: false,
        dryRun: false,
      }),
    ).toThrow(/must not be a symlink/u);

    symlinkSync(join(source, "SKILL.md"), join(source, "linked.md"));
    expect(() => fileManifest(source)).toThrow(/must not contain symlinks/u);
    expect(existsSync(join(source, "linked.md"))).toBe(true);
  });
});

describe("SimpleDoc path safety", () => {
  it("rejects destinations above or below the source", () => {
    const root = temporaryDirectory();
    const checkout = join(root, "checkout");
    const source = join(checkout, "skills", "simpledoc");
    createSimpleDocSkill(source);
    writeFileSync(join(checkout, "keep.txt"), "keep\n", "utf8");

    expect(() =>
      syncSimpleDocSkill({
        source,
        destination: checkout,
        check: false,
        dryRun: false,
      }),
    ).toThrow(/non-overlapping/u);
    expect(readFileSync(join(checkout, "keep.txt"), "utf8")).toBe("keep\n");

    expect(() =>
      syncSimpleDocSkill({
        source,
        destination: join(source, "copy"),
        check: false,
        dryRun: false,
      }),
    ).toThrow(/non-overlapping/u);
    expect(existsSync(join(source, "SKILL.md"))).toBe(true);
  });
});
