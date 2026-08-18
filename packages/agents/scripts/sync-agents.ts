#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildDestinations,
  discoverSkills,
  parseCli,
  resolveSelection,
  skillTreesMatch,
  STATE_FILE_NAME,
  syncFile,
  syncSkills,
  type CopyDestination,
  type Skill,
  type SyncOptions,
} from "./sync-skills.ts";

const PRIVATE_REPOSITORY_NAME = "agents";
const LEGACY_STATE_FILE_NAME = ".tools-agents-skill-sync.json";

type Command = "check" | "sync";

type AgentCliOptions = {
  command: Command;
  privateRoot: string;
  sharedAgentsDest: string;
  sharedSkillsDest: string;
  coreArgs: string[];
};

type Sources = {
  temporaryRoot: string;
  agentsSource: string;
  skillsRoot: string;
  publicSkills: Skill[];
  privateSkills: Skill[];
};

function replaceHome(value: string): string {
  return resolve(value.replace(/^~/u, homedir()));
}

function takeValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value`);
  args.splice(index, 2);
  return value;
}

function extractValue(args: string[], option: string, fallback: string): string {
  const index = args.indexOf(option);
  return index < 0 ? fallback : replaceHome(takeValue(args, index, option));
}

function resolvePrivateRoot(explicitPrivateRoot: string | undefined): string {
  const configured = process.env["AGENTS_REPO"];
  return (
    explicitPrivateRoot ??
    replaceHome(configured ?? join(homedir(), "repos", PRIVATE_REPOSITORY_NAME))
  );
}

export function parseAgentCli(argv: string[]): AgentCliOptions {
  const args = [...argv];
  const rawCommand = args.shift();
  if (rawCommand !== "sync" && rawCommand !== "check") {
    throw new Error("The first argument must be sync or check");
  }
  const privateRootIndex = args.indexOf("--private-root");
  const privateRoot = resolvePrivateRoot(
    privateRootIndex < 0
      ? undefined
      : replaceHome(takeValue(args, privateRootIndex, "--private-root")),
  );
  const sharedAgentsDest = extractValue(
    args,
    "--shared-agents-dest",
    join(homedir(), ".agents", "AGENTS.md"),
  );
  const sharedSkillsDest = extractValue(
    args,
    "--shared-skills-dest",
    join(homedir(), ".agents", "skills"),
  );
  return {
    command: rawCommand,
    privateRoot,
    sharedAgentsDest,
    sharedSkillsDest,
    coreArgs: args,
  };
}

function assertInstructionSource(path: string): void {
  if (!existsSync(path)) throw new Error(`Missing instruction source: ${path}`);
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Instruction source must be a regular file: ${path}`);
  }
}

function copySkills(skills: Skill[], destination: string): void {
  for (const skill of skills) {
    cpSync(skill.sourcePath, join(destination, skill.skillId), {
      recursive: true,
      preserveTimestamps: true,
    });
  }
}

function assertUniqueSkillOwners(publicSkills: Skill[], privateSkills: Skill[]): void {
  const owners = new Map<string, string>();
  for (const [owner, skills] of [
    ["public", publicSkills],
    ["private", privateSkills],
  ] as const) {
    for (const skill of skills) {
      const previous = owners.get(skill.skillId);
      if (previous !== undefined) {
        throw new Error(`Skill ${skill.skillId} exists in both ${previous} and ${owner} sources`);
      }
      owners.set(skill.skillId, owner);
    }
  }
}

export function loadSources(publicSkillsRoot: string, privateRoot: string): Sources {
  const agentsSource = join(privateRoot, "AGENTS.md");
  const privateSkillsRoot = join(privateRoot, "skills");
  assertInstructionSource(agentsSource);
  const publicSkills = discoverSkills(publicSkillsRoot);
  const privateSkills = discoverSkills(privateSkillsRoot);
  assertUniqueSkillOwners(publicSkills, privateSkills);

  const temporaryRoot = mkdtempSync(join(tmpdir(), "onurpi-agents-sync-"));
  const skillsRoot = join(temporaryRoot, "skills");
  mkdirSync(skillsRoot);
  copySkills(publicSkills, skillsRoot);
  copySkills(privateSkills, skillsRoot);
  return { temporaryRoot, agentsSource, skillsRoot, publicSkills, privateSkills };
}

function readStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid synchronization state: ${path}`);
  }
  return [...(value as string[])].sort();
}

function readState(skillsRoot: string): { managed: string[]; pending: string[] } {
  const path = join(skillsRoot, STATE_FILE_NAME);
  if (!existsSync(path)) throw new Error(`Missing synchronization state: ${path}`);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid synchronization state: ${path}`);
  }
  const record = parsed as Record<string, unknown>;
  return {
    managed: readStringArray(record["managed_skill_ids"], path),
    pending: readStringArray(record["pending_skill_ids"], path),
  };
}

function assertFileMatches(source: string, destination: string): void {
  if (!existsSync(destination))
    throw new Error(`Missing synchronized instructions: ${destination}`);
  if (lstatSync(destination).isSymbolicLink()) {
    throw new Error(`Synchronized instructions must not be a symlink: ${destination}`);
  }
  if (!readFileSync(source).equals(readFileSync(destination))) {
    throw new Error(`Synchronized instructions differ from source: ${destination}`);
  }
}

function assertSkillCopies(skills: Skill[], destination: string): void {
  for (const skill of skills) {
    const target = join(destination, skill.skillId);
    if (!existsSync(target) || !skillTreesMatch(skill, target)) {
      throw new Error(`Synchronized skill differs from source: ${target}`);
    }
  }
}

function assertManagedState(skillsRoot: string, expectedIds: string[]): void {
  const state = readState(skillsRoot);
  if (state.pending.length !== 0) {
    throw new Error(`Synchronization has incomplete skill copies: ${skillsRoot}`);
  }
  const expected = [...expectedIds].sort();
  if (JSON.stringify(state.managed) !== JSON.stringify(expected)) {
    throw new Error(`Managed skill set differs from source: ${skillsRoot}`);
  }
}

function selectedPrivateSkills(
  allSkills: Skill[],
  privateSkills: Skill[],
  selectors: string[],
): Skill[] {
  if (selectors.length === 0) return privateSkills;
  const privateIds = new Set(privateSkills.map((skill) => skill.skillId));
  return resolveSelection(allSkills, selectors).filter((skill) => privateIds.has(skill.skillId));
}

function regularSyncOptions(
  sources: Sources,
  parsed: ReturnType<typeof parseCli>,
  destinations: CopyDestination[],
): SyncOptions {
  return {
    sourceRoot: sources.skillsRoot,
    stateSourceRoot: parsed.sourceRoot,
    agentsSource: sources.agentsSource,
    destinations,
    ...(parsed.skipPi
      ? {}
      : { piDestination: { configRoot: dirname(parsed.piDest), skillsRoot: parsed.piDest } }),
    selectors: parsed.selectors,
    prune: parsed.prune ?? parsed.selectors.length === 0,
    dryRun: parsed.dryRun,
  };
}

function privateSourceRoot(sources: Sources): string {
  const firstPrivateSkill = sources.privateSkills[0];
  if (firstPrivateSkill !== undefined) return dirname(firstPrivateSkill.sourcePath);
  const emptyRoot = join(sources.temporaryRoot, "private-skills");
  if (!existsSync(emptyRoot)) mkdirSync(emptyRoot);
  return emptyRoot;
}

function privatePiSyncOptions(
  sources: Sources,
  parsed: ReturnType<typeof parseCli>,
  sharedSkillsDest: string,
): SyncOptions | undefined {
  if (parsed.skipPi) return undefined;
  const allSkills = [...sources.publicSkills, ...sources.privateSkills];
  const selected = selectedPrivateSkills(allSkills, sources.privateSkills, parsed.selectors);
  if (parsed.selectors.length > 0 && selected.length === 0) return undefined;
  const privateSkillsRoot = privateSourceRoot(sources);
  return {
    sourceRoot: privateSkillsRoot,
    stateSourceRoot: privateSkillsRoot,
    agentsSource: sources.agentsSource,
    destinations: [
      {
        name: "Pi private skills",
        skillsRoot: sharedSkillsDest,
        agentsDest: join(dirname(parsed.piDest), "AGENTS.md"),
        restartHint: "Run /reload in Pi or start a new Pi session.",
      },
    ],
    selectors: selected.map((skill) => skill.skillId),
    prune: parsed.prune ?? parsed.selectors.length === 0,
    dryRun: parsed.dryRun,
  };
}

function checkPiInstalled(
  sources: Sources,
  parsed: ReturnType<typeof parseCli>,
  allSkills: Skill[],
  fullCheck: boolean,
  sharedAgentsDest: string,
  sharedSkillsDest: string,
): void {
  assertFileMatches(sources.agentsSource, join(dirname(parsed.piDest), "AGENTS.md"));
  assertFileMatches(sources.agentsSource, sharedAgentsDest);
  const selectedPrivate = selectedPrivateSkills(allSkills, sources.privateSkills, parsed.selectors);
  assertSkillCopies(selectedPrivate, sharedSkillsDest);
  if (!fullCheck) return;
  assertManagedState(
    sharedSkillsDest,
    sources.privateSkills.map((skill) => skill.skillId),
  );
  for (const fileName of [STATE_FILE_NAME, LEGACY_STATE_FILE_NAME]) {
    const path = join(parsed.piDest, fileName);
    if (existsSync(path)) throw new Error(`Legacy Pi synchronization state remains: ${path}`);
  }
}

function checkInstalled(
  sources: Sources,
  parsed: ReturnType<typeof parseCli>,
  destinations: CopyDestination[],
  sharedAgentsDest: string,
  sharedSkillsDest: string,
): void {
  const allSkills = discoverSkills(sources.skillsRoot);
  const selected = resolveSelection(allSkills, parsed.selectors);
  const fullCheck =
    (parsed.prune ?? parsed.selectors.length === 0) && parsed.selectors.length === 0;
  for (const destination of destinations) {
    assertFileMatches(sources.agentsSource, destination.agentsDest);
    assertSkillCopies(selected, destination.skillsRoot);
    if (fullCheck)
      assertManagedState(
        destination.skillsRoot,
        allSkills.map((skill) => skill.skillId),
      );
  }
  if (parsed.skipPi) return;
  checkPiInstalled(sources, parsed, allSkills, fullCheck, sharedAgentsDest, sharedSkillsDest);
}

function runSynchronization(
  sources: Sources,
  parsed: ReturnType<typeof parseCli>,
  destinations: CopyDestination[],
  sharedAgentsDest: string,
  sharedSkillsDest: string,
): void {
  const regular = regularSyncOptions(sources, parsed, destinations);
  const privatePi = privatePiSyncOptions(sources, parsed, sharedSkillsDest);
  syncSkills({ ...regular, dryRun: true, log: () => undefined });
  if (privatePi !== undefined) syncSkills({ ...privatePi, dryRun: true, log: () => undefined });
  if (parsed.dryRun) {
    console.log("Agent synchronization preflight passed.");
    return;
  }
  if (!parsed.skipPi) syncFile(sources.agentsSource, sharedAgentsDest, false);
  syncSkills(regular);
  if (privatePi !== undefined) syncSkills(privatePi);
}

function runCommand(
  cli: AgentCliOptions,
  sources: Sources,
  parsed: ReturnType<typeof parseCli>,
  destinations: CopyDestination[],
): void {
  if (cli.command === "sync") {
    runSynchronization(sources, parsed, destinations, cli.sharedAgentsDest, cli.sharedSkillsDest);
    return;
  }
  checkInstalled(sources, parsed, destinations, cli.sharedAgentsDest, cli.sharedSkillsDest);
  console.log("Agent files and skills are synchronized.");
}

export function runAgentCli(
  argv: string[],
  packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
): void {
  const cli = parseAgentCli(argv);
  const parsed = parseCli(cli.coreArgs, packageRoot);
  if (parsed.skipCodex && parsed.skipClaude && parsed.skipCursor && parsed.skipPi) {
    throw new Error("Nothing to do: every destination was skipped");
  }
  const destinations = buildDestinations(parsed);
  const sources = loadSources(parsed.sourceRoot, cli.privateRoot);
  try {
    runCommand(cli, sources, parsed, destinations);
  } finally {
    rmSync(sources.temporaryRoot, { force: true, recursive: true });
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  runAgentCli(process.argv.slice(2));
}
