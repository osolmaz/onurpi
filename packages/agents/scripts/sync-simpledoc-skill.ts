#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { replaceDirectory } from "./atomic-directory.ts";

const FRONTMATTER_RE = /^---\n(.*?)\n---(?:\n|$)/su;
const NAME_RE = /^name:\s*simpledoc\s*$/mu;

type FileState = { digest: string; mode: number };
type FileManifest = Map<string, FileState>;

export type SimpleDocSyncOptions = {
  source: string;
  destination: string;
  check: boolean;
  dryRun: boolean;
  log?: (message: string) => void;
};

export type SimpleDocSyncResult = {
  changed: boolean;
  exitCode: number;
  drift: string[];
};

export function validateSimpleDocSkill(skillDirectory: string): void {
  const skillFile = join(skillDirectory, "SKILL.md");
  if (!existsSync(skillFile)) throw new Error(`Missing SimpleDoc skill file: ${skillFile}`);
  const content = readFileSync(skillFile, "utf8");
  const frontmatter = FRONTMATTER_RE.exec(content)?.[1];
  if (frontmatter === undefined || !NAME_RE.test(frontmatter)) {
    throw new Error(`Expected frontmatter name 'simpledoc' in ${skillFile}`);
  }
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walkFiles(root: string, directory: string, manifest: FileManifest): void {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) throw new Error(`Skill trees must not contain symlinks: ${path}`);
    if (stats.isDirectory()) walkFiles(root, path, manifest);
    else if (stats.isFile()) {
      manifest.set(relative(root, path).split("\\").join("/"), {
        digest: hashFile(path),
        mode: stats.mode & 0o777,
      });
    }
  }
}

export function fileManifest(root: string): FileManifest {
  const manifest: FileManifest = new Map();
  if (existsSync(root)) walkFiles(root, root, manifest);
  return manifest;
}

export function describeDrift(source: FileManifest, destination: FileManifest): string[] {
  const messages: string[] = [];
  for (const path of [...source.keys()].sort()) {
    const destinationState = destination.get(path);
    if (destinationState === undefined) messages.push(`missing from destination: ${path}`);
    else {
      const sourceState = source.get(path);
      if (
        sourceState?.digest !== destinationState.digest ||
        sourceState.mode !== destinationState.mode
      ) {
        messages.push(`different: ${path}`);
      }
    }
  }
  for (const path of [...destination.keys()].sort()) {
    if (!source.has(path)) messages.push(`only in destination: ${path}`);
  }
  return messages;
}

function copySkill(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  const temporaryDirectory = mkdtempSync(join(dirname(destination), ".simpledoc-skill-"));
  const staged = join(temporaryDirectory, "simpledoc");
  try {
    cpSync(source, staged, { recursive: true, preserveTimestamps: true });
    replaceDirectory(staged, destination, temporaryDirectory);
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function containsPath(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function validateSyncPaths(source: string, destination: string): void {
  if (containsPath(source, destination) || containsPath(destination, source)) {
    throw new Error("Source and destination must be separate, non-overlapping directories");
  }
  if (!existsSync(source)) throw new Error(`Missing SimpleDoc skill source: ${source}`);
  if (lstatSync(source).isSymbolicLink()) {
    throw new Error(`SimpleDoc skill source must not be a symlink: ${source}`);
  }
  validateSimpleDocSkill(source);
}

export function syncSimpleDocSkill(options: SimpleDocSyncOptions): SimpleDocSyncResult {
  const log = options.log ?? console.log;
  const source = resolve(options.source);
  const destination = resolve(options.destination);
  validateSyncPaths(source, destination);
  const drift = describeDrift(fileManifest(source), fileManifest(destination));
  if (drift.length === 0) {
    log(`SimpleDoc skill is up to date: ${destination}`);
    return { changed: false, exitCode: 0, drift };
  }
  if (options.check) {
    log("SimpleDoc skill copy is out of date:");
    for (const message of drift) log(`- ${message}`);
    return { changed: false, exitCode: 1, drift };
  }
  if (options.dryRun) {
    log(`Would sync SimpleDoc skill: ${source} -> ${destination}`);
    for (const message of drift) log(`- ${message}`);
    return { changed: false, exitCode: 0, drift };
  }
  copySkill(source, destination);
  log(`Synced SimpleDoc skill: ${source} -> ${destination}`);
  return { changed: true, exitCode: 0, drift };
}

type CliOptions = {
  source: string;
  destination: string;
  check: boolean;
  dryRun: boolean;
};

function extractFlag(args: string[], option: string): boolean {
  const index = args.indexOf(option);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function extractPath(args: string[], option: string, fallback: string): string {
  const index = args.indexOf(option);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value`);
  args.splice(index, 2);
  return resolve(value.replace(/^~/u, homedir()));
}

export function parseSimpleDocCli(
  argv: string[],
  packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
): CliOptions {
  const args = [...argv];
  const configuredRepo = process.env["SIMPLEDOC_REPO"];
  const defaultSource = join(
    configuredRepo ?? join(homedir(), "repos", "SimpleDoc"),
    "skills",
    "simpledoc",
  );
  const source = extractPath(args, "--source", defaultSource);
  const destination = extractPath(args, "--destination", join(packageRoot, "skills", "simpledoc"));
  const check = extractFlag(args, "--check");
  const dryRun = extractFlag(args, "--dry-run");
  if (check && dryRun) throw new Error("--check and --dry-run cannot be used together");
  const unknownArgument = args[0];
  if (unknownArgument !== undefined) throw new Error(`Unknown argument ${unknownArgument}`);
  return { source, destination, check, dryRun };
}

export function runSimpleDocCli(argv: string[]): number {
  return syncSimpleDocSkill(parseSimpleDocCli(argv)).exitCode;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  process.exitCode = runSimpleDocCli(process.argv.slice(2));
}
