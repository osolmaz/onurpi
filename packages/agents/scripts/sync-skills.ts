#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { replaceDirectory } from "./atomic-directory.ts";

export const STATE_FILE_NAME = ".onurpi-agents-sync.json";
export const LEGACY_STATE_FILE_NAME = ".tools-agents-skill-sync.json";

const FRONTMATTER_RE = /^---\n(.*?)\n---(?:\n|$)/su;
const NAME_RE = /^name:\s*(.+?)\s*$/mu;
const SKILL_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

type Logger = (message: string) => void;

export type Skill = {
  sourceName: string;
  skillId: string;
  sourcePath: string;
};

export type CopyDestination = {
  name: string;
  skillsRoot: string;
  agentsDest: string;
  restartHint: string;
};

export type PiDestination = {
  configRoot: string;
  skillsRoot: string;
};

export type SyncOptions = {
  sourceRoot: string;
  agentsSource: string;
  destinations: CopyDestination[];
  piDestination?: PiDestination;
  selectors: string[];
  prune: boolean;
  dryRun: boolean;
  log?: Logger;
};

type SyncState = {
  version: 1;
  sourceRoot: string;
  managedSkillIds: string[];
};

type CliOptions = {
  sourceRoot: string;
  agentsSource: string;
  codexDest: string;
  claudeDest: string;
  cursorDest: string;
  cursorAgentsDest: string;
  piDest: string;
  selectors: string[];
  skipCodex: boolean;
  skipClaude: boolean;
  skipCursor: boolean;
  skipPi: boolean;
  prune: boolean | undefined;
  dryRun: boolean;
};

function assertSkillId(value: string, context: string): void {
  if (!SKILL_ID_RE.test(value))
    throw new Error(`Invalid skill id ${JSON.stringify(value)} in ${context}`);
}

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function parseSkillId(skillDirectory: string): string {
  const skillFile = join(skillDirectory, "SKILL.md");
  if (!existsSync(skillFile)) throw new Error(`Missing SKILL.md in ${skillDirectory}`);
  const content = readFileSync(skillFile, "utf8");
  const frontmatter = FRONTMATTER_RE.exec(content)?.[1];
  if (frontmatter === undefined) throw new Error(`Invalid SKILL.md frontmatter in ${skillFile}`);
  const rawName = NAME_RE.exec(frontmatter)?.[1];
  if (rawName === undefined) throw new Error(`Missing frontmatter name in ${skillFile}`);
  const skillId = stripYamlQuotes(rawName);
  assertSkillId(skillId, skillFile);
  return skillId;
}

function rejectSymlinks(root: string): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) {
      throw new Error(`Skill trees must not contain symlinks: ${path}`);
    }
    if (entry.isDirectory()) rejectSymlinks(path);
  }
}

export function discoverSkills(sourceRoot: string): Skill[] {
  if (!existsSync(sourceRoot)) throw new Error(`Missing skill source root: ${sourceRoot}`);
  const skills: Skill[] = [];
  const seenIds = new Map<string, string>();
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const sourcePath = join(sourceRoot, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Skill trees must not contain symlinks: ${sourcePath}`);
    }
    if (!entry.isDirectory() || !existsSync(join(sourcePath, "SKILL.md"))) continue;
    rejectSymlinks(sourcePath);
    const skillId = parseSkillId(sourcePath);
    const previous = seenIds.get(skillId);
    if (previous !== undefined) {
      throw new Error(
        `Duplicate skill id ${JSON.stringify(skillId)} in ${previous} and ${sourcePath}`,
      );
    }
    seenIds.set(skillId, sourcePath);
    skills.push({ sourceName: entry.name, skillId, sourcePath });
  }
  return skills;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readManagedIds(path: string, legacy: boolean): string[] {
  if (!existsSync(path)) return [];
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed["managed_skill_ids"])) {
    throw new Error(`Invalid synchronization state in ${path}`);
  }
  if (legacy) validateLegacySource(parsed["source_root"], path);
  const ids = parsed["managed_skill_ids"];
  if (ids.some((value) => typeof value !== "string")) {
    throw new Error(`Invalid managed skill ids in ${path}`);
  }
  for (const id of ids) assertSkillId(id as string, path);
  return ids as string[];
}

function validateLegacySource(sourceRoot: unknown, statePath: string): void {
  if (typeof sourceRoot !== "string") throw new Error(`Missing legacy source root in ${statePath}`);
  const parts = resolve(sourceRoot).split(sep);
  if (parts.slice(-3).join("/") !== "tools/agents/skills") {
    throw new Error(`Refusing legacy state from an unknown source: ${sourceRoot}`);
  }
}

function statePath(root: string, fileName: string): string {
  return join(root, fileName);
}

function loadManagedIds(skillsRoot: string): Set<string> {
  return new Set([
    ...readManagedIds(statePath(skillsRoot, STATE_FILE_NAME), false),
    ...readManagedIds(statePath(skillsRoot, LEGACY_STATE_FILE_NAME), true),
  ]);
}

function writeState(path: string, sourceRoot: string, managedSkillIds: string[]): void {
  const state: SyncState = {
    version: 1,
    sourceRoot,
    managedSkillIds: [...managedSkillIds].sort(),
  };
  const serialized = {
    version: state.version,
    source_root: state.sourceRoot,
    managed_skill_ids: state.managedSkillIds,
  };
  mkdirSync(dirname(path), { recursive: true });
  const temporaryDirectory = mkdtempSync(join(dirname(path), `.${basename(path)}.tmp-`));
  const temporaryPath = join(temporaryDirectory, basename(path));
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(serialized, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function persistManagedState(skillsRoot: string, sourceRoot: string, managed: Set<string>): void {
  writeState(statePath(skillsRoot, STATE_FILE_NAME), sourceRoot, [...managed]);
}

function removePath(path: string, dryRun: boolean): void {
  if (!existsSync(path) || dryRun) return;
  const stats = lstatSync(path);
  if (stats.isDirectory() && !stats.isSymbolicLink()) rmSync(path, { recursive: true });
  else unlinkSync(path);
}

function syncFile(sourcePath: string, destPath: string, dryRun: boolean): void {
  if (lstatSync(sourcePath).isSymbolicLink())
    throw new Error(`Source files must not be symlinks: ${sourcePath}`);
  if (dryRun) return;
  mkdirSync(dirname(destPath), { recursive: true });
  const temporaryDirectory = mkdtempSync(join(dirname(destPath), `.${basename(destPath)}.tmp-`));
  const temporaryPath = join(temporaryDirectory, basename(destPath));
  try {
    cpSync(sourcePath, temporaryPath, { preserveTimestamps: true });
    renameSync(temporaryPath, destPath);
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function shouldCopySkillPath(root: string, path: string): boolean {
  if (path === root) return true;
  return basename(path) !== "SKILL.md" || dirname(path) === root;
}

type TreeManifest = Map<string, string>;

function addTreeEntries(
  root: string,
  directory: string,
  manifest: TreeManifest,
  source: boolean,
): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (source && !shouldCopySkillPath(root, path)) continue;
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) throw new Error(`Skill trees must not contain symlinks: ${path}`);
    if (stats.isDirectory()) addTreeEntries(root, path, manifest, source);
    else if (stats.isFile()) {
      const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
      manifest.set(
        relative(root, path).split(sep).join("/"),
        `${String(stats.mode & 0o777)}:${digest}`,
      );
    }
  }
}

function treeManifest(root: string, source: boolean): TreeManifest {
  if (lstatSync(root).isSymbolicLink())
    throw new Error(`Skill trees must not contain symlinks: ${root}`);
  const manifest: TreeManifest = new Map();
  addTreeEntries(root, root, manifest, source);
  return manifest;
}

function skillTreesMatch(skill: Skill, destination: string): boolean {
  const destinationStats = lstatSync(destination);
  if (!destinationStats.isDirectory() || destinationStats.isSymbolicLink()) return false;
  const sourceManifest = treeManifest(skill.sourcePath, true);
  const destinationManifest = treeManifest(destination, false);
  return (
    sourceManifest.size === destinationManifest.size &&
    [...sourceManifest].every(([path, value]) => destinationManifest.get(path) === value)
  );
}

function syncSkill(skill: Skill, destRoot: string, dryRun: boolean): void {
  const destPath = join(destRoot, skill.skillId);
  if (dryRun) return;
  mkdirSync(destRoot, { recursive: true });
  const temporaryDirectory = mkdtempSync(join(destRoot, `.${skill.skillId}.tmp-`));
  const temporaryPath = join(temporaryDirectory, skill.skillId);
  try {
    cpSync(skill.sourcePath, temporaryPath, {
      recursive: true,
      preserveTimestamps: true,
      filter: (path) => shouldCopySkillPath(skill.sourcePath, path),
    });
    replaceDirectory(temporaryPath, destPath, temporaryDirectory);
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

export function resolveSelection(skills: Skill[], selectors: string[]): Skill[] {
  if (selectors.length === 0) return skills;
  const bySelector = new Map<string, Skill>();
  for (const skill of skills) {
    bySelector.set(skill.sourceName, skill);
    bySelector.set(skill.skillId, skill);
  }
  const selected: Skill[] = [];
  const seen = new Set<string>();
  for (const selector of selectors) {
    const skill = bySelector.get(selector);
    if (skill === undefined) throw new Error(`Unknown skill selector ${JSON.stringify(selector)}`);
    if (!seen.has(skill.skillId)) selected.push(skill);
    seen.add(skill.skillId);
  }
  return selected;
}

function assertNoUnownedCollisions(
  skillsRoot: string,
  selected: Skill[],
  oldManaged: Set<string>,
): void {
  for (const skill of selected) {
    const destinationPath = join(skillsRoot, skill.skillId);
    if (
      existsSync(destinationPath) &&
      !oldManaged.has(skill.skillId) &&
      !skillTreesMatch(skill, destinationPath)
    ) {
      throw new Error(`Refusing to replace unowned skill ${skill.skillId} at ${destinationPath}`);
    }
  }
}

type CopySyncOptions = Pick<SyncOptions, "agentsSource" | "sourceRoot" | "prune" | "dryRun">;

function removeStaleSkills(
  skillsRoot: string,
  staleIds: string[],
  managed: Set<string>,
  options: CopySyncOptions,
  log: Logger,
): void {
  for (const staleId of staleIds) {
    log(`Removing stale managed skill ${staleId}`);
    removePath(join(skillsRoot, staleId), options.dryRun);
    if (!options.dryRun) {
      managed.delete(staleId);
      persistManagedState(skillsRoot, options.sourceRoot, managed);
    }
  }
}

function copySelectedSkills(
  skillsRoot: string,
  selected: Skill[],
  managed: Set<string>,
  options: CopySyncOptions,
  log: Logger,
): void {
  for (const skill of selected) {
    log(`Syncing ${skill.skillId} -> ${join(skillsRoot, skill.skillId)}`);
    syncSkill(skill, skillsRoot, options.dryRun);
    if (!options.dryRun && !managed.has(skill.skillId)) {
      managed.add(skill.skillId);
      persistManagedState(skillsRoot, options.sourceRoot, managed);
    }
  }
}

function syncCopyDestination(
  destination: CopyDestination,
  options: CopySyncOptions,
  selected: Skill[],
  log: Logger,
): void {
  const oldManaged = loadManagedIds(destination.skillsRoot);
  const selectedIds = new Set(selected.map((skill) => skill.skillId));
  const staleIds = options.prune ? [...oldManaged].filter((id) => !selectedIds.has(id)).sort() : [];
  assertNoUnownedCollisions(destination.skillsRoot, selected, oldManaged);
  log(`== ${destination.name} ==`);
  const managed = new Set(oldManaged);
  if (!options.dryRun) {
    persistManagedState(destination.skillsRoot, options.sourceRoot, managed);
    removePath(statePath(destination.skillsRoot, LEGACY_STATE_FILE_NAME), false);
  }
  log(`Syncing instructions -> ${destination.agentsDest}`);
  syncFile(options.agentsSource, destination.agentsDest, options.dryRun);
  removeStaleSkills(destination.skillsRoot, staleIds, managed, options, log);
  copySelectedSkills(destination.skillsRoot, selected, managed, options, log);
  if (!options.dryRun) log(destination.restartHint);
}

function syncPiDestination(
  destination: PiDestination,
  agentsSource: string,
  dryRun: boolean,
  log: Logger,
): void {
  log("== Pi ==");
  const agentsDest = join(destination.configRoot, "AGENTS.md");
  log(`Syncing instructions -> ${agentsDest}`);
  syncFile(agentsSource, agentsDest, dryRun);
  const managed = loadManagedIds(destination.skillsRoot);
  for (const skillId of [...managed].sort()) {
    log(`Removing legacy Pi skill copy ${skillId}`);
    removePath(join(destination.skillsRoot, skillId), dryRun);
  }
  if (!dryRun) {
    removePath(statePath(destination.skillsRoot, STATE_FILE_NAME), false);
    removePath(statePath(destination.skillsRoot, LEGACY_STATE_FILE_NAME), false);
  }
  log("Run /reload in Pi or start a new Pi session.");
}

export function syncSkills(options: SyncOptions): void {
  const log = options.log ?? console.log;
  const sourceRoot = resolve(options.sourceRoot);
  const agentsSource = resolve(options.agentsSource);
  if (!existsSync(agentsSource)) throw new Error(`Missing AGENTS.md at ${agentsSource}`);
  const skills = discoverSkills(sourceRoot);
  const selected = resolveSelection(skills, options.selectors);
  log(`Source root: ${sourceRoot}`);
  log(`Selected skills: ${selected.map((skill) => skill.skillId).join(", ") || "none"}`);
  for (const destination of options.destinations) {
    syncCopyDestination(destination, { ...options, sourceRoot, agentsSource }, selected, log);
  }
  if (options.piDestination !== undefined) {
    syncPiDestination(options.piDestination, agentsSource, options.dryRun, log);
  }
}

function envPath(name: string, fallback: string): string {
  const value = process.env[name];
  return resolve(value === undefined ? fallback : value.replace(/^~/u, homedir()));
}

function defaultCursorAgentsDest(): string {
  const explicit = process.env["CURSOR_AGENTS_DEST"];
  if (explicit !== undefined) return resolve(explicit.replace(/^~/u, homedir()));
  const workspace = process.env["CURSOR_WORKSPACE_ROOT"];
  return resolve(
    workspace === undefined ? join(homedir(), "AGENTS.md") : join(workspace, "AGENTS.md"),
  );
}

function takeValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value`);
  args.splice(index, 2);
  return value;
}

function extractValue(args: string[], option: string, fallback: string): string {
  const index = args.indexOf(option);
  return index < 0 ? fallback : resolve(takeValue(args, index, option).replace(/^~/u, homedir()));
}

function extractFlag(args: string[], option: string): boolean {
  const index = args.indexOf(option);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

export function parseCli(
  argv: string[],
  packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
): CliOptions {
  const args = [...argv];
  const codexHome = envPath("CODEX_HOME", join(homedir(), ".codex"));
  const claudeHome = envPath("CLAUDE_CONFIG_DIR", join(homedir(), ".claude"));
  const cursorHome = envPath("CURSOR_CONFIG_DIR", join(homedir(), ".cursor"));
  const piHome = envPath("PI_CODING_AGENT_DIR", join(homedir(), ".pi", "agent"));
  const sourceRoot = extractValue(args, "--source-root", join(packageRoot, "skills"));
  const agentsSource = extractValue(args, "--agents-source", join(packageRoot, "AGENTS.md"));
  const codexDest = extractValue(args, "--dest", join(codexHome, "skills"));
  const claudeDest = extractValue(args, "--claude-dest", join(claudeHome, "skills"));
  const cursorDest = extractValue(args, "--cursor-dest", join(cursorHome, "skills"));
  const cursorAgentsDest = extractValue(args, "--cursor-agents-dest", defaultCursorAgentsDest());
  const piDest = extractValue(args, "--pi-dest", join(piHome, "skills"));
  const skipCodex = extractFlag(args, "--skip-codex");
  const skipClaude = extractFlag(args, "--skip-claude");
  const skipCursor = extractFlag(args, "--skip-cursor");
  const skipPi = extractFlag(args, "--skip-pi");
  const pruneFlag = extractFlag(args, "--prune");
  const noPruneFlag = extractFlag(args, "--no-prune");
  const dryRun = extractFlag(args, "--dry-run");
  if (pruneFlag && noPruneFlag) throw new Error("--prune and --no-prune cannot be used together");
  const unknownOption = args.find((arg) => arg.startsWith("--"));
  if (unknownOption !== undefined) throw new Error(`Unknown option ${unknownOption}`);
  return {
    sourceRoot,
    agentsSource,
    codexDest,
    claudeDest,
    cursorDest,
    cursorAgentsDest,
    piDest,
    selectors: args,
    skipCodex,
    skipClaude,
    skipCursor,
    skipPi,
    prune: pruneFlag ? true : noPruneFlag ? false : undefined,
    dryRun,
  };
}

function buildDestinations(options: CliOptions): CopyDestination[] {
  const destinations: CopyDestination[] = [];
  if (!options.skipCodex) {
    destinations.push({
      name: "Codex",
      skillsRoot: options.codexDest,
      agentsDest: join(dirname(options.codexDest), "AGENTS.md"),
      restartHint: "Restart Codex to load synchronized skills.",
    });
  }
  if (!options.skipClaude) {
    destinations.push({
      name: "Claude Code",
      skillsRoot: options.claudeDest,
      agentsDest: join(dirname(options.claudeDest), "CLAUDE.md"),
      restartHint: "Start a new Claude Code session to load synchronized skills.",
    });
  }
  if (!options.skipCursor) {
    destinations.push({
      name: "Cursor",
      skillsRoot: options.cursorDest,
      agentsDest: options.cursorAgentsDest,
      restartHint: "Restart Cursor to load synchronized personal skills.",
    });
  }
  return destinations;
}

export function runCli(argv: string[]): void {
  const options = parseCli(argv);
  if (options.skipCodex && options.skipClaude && options.skipCursor && options.skipPi) {
    throw new Error("Nothing to do: every destination was skipped");
  }
  const piDestination = { configRoot: dirname(options.piDest), skillsRoot: options.piDest };
  syncSkills({
    sourceRoot: options.sourceRoot,
    agentsSource: options.agentsSource,
    destinations: buildDestinations(options),
    ...(options.skipPi ? {} : { piDestination }),
    selectors: options.selectors,
    prune: options.prune ?? options.selectors.length === 0,
    dryRun: options.dryRun,
  });
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  runCli(process.argv.slice(2));
}
