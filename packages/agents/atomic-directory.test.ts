import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { recoverDirectoryReplacement, replaceDirectory } from "./scripts/atomic-directory.ts";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "onurpi-atomic-directory-"));
  temporaryDirectories.push(path);
  return path;
}

function backup(root: string): string {
  return join(root, ".destination.onurpi-backup");
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { force: true, recursive: true });
});

describe("replaceDirectory", () => {
  it("replaces an existing directory and removes its backup", () => {
    const root = temporaryDirectory();
    const destination = join(root, "destination");
    const staged = join(root, "staged");
    mkdirSync(destination);
    mkdirSync(staged);
    writeFileSync(join(destination, "value"), "old\n", "utf8");
    writeFileSync(join(staged, "value"), "new\n", "utf8");

    replaceDirectory(staged, destination);

    expect(readFileSync(join(destination, "value"), "utf8")).toBe("new\n");
    expect(existsSync(backup(root))).toBe(false);
  });

  it("restores the previous directory when the staged rename fails", () => {
    const root = temporaryDirectory();
    const destination = join(root, "destination");
    mkdirSync(destination);
    writeFileSync(join(destination, "value"), "old\n", "utf8");

    expect(() => {
      replaceDirectory(join(root, "missing"), destination);
    }).toThrow();

    expect(readFileSync(join(destination, "value"), "utf8")).toBe("old\n");
    expect(existsSync(backup(root))).toBe(false);
  });

  it("recovers a backup left before staged content became active", () => {
    const root = temporaryDirectory();
    const destination = join(root, "destination");
    mkdirSync(backup(root));
    writeFileSync(join(backup(root), "value"), "old\n", "utf8");

    recoverDirectoryReplacement(destination);

    expect(readFileSync(join(destination, "value"), "utf8")).toBe("old\n");
    expect(existsSync(backup(root))).toBe(false);
  });

  it("removes a backup left after staged content became active", () => {
    const root = temporaryDirectory();
    const destination = join(root, "destination");
    mkdirSync(destination);
    mkdirSync(backup(root));
    writeFileSync(join(destination, "value"), "new\n", "utf8");
    writeFileSync(join(backup(root), "value"), "old\n", "utf8");

    recoverDirectoryReplacement(destination);

    expect(readFileSync(join(destination, "value"), "utf8")).toBe("new\n");
    expect(existsSync(backup(root))).toBe(false);
  });
});
