// Keep the tracked copies of global Pi configuration in step with the live agent directory.
//
//   node scripts/sync-settings.ts sync    live settings -> tracked settings.json (normalized)
//                                         live models   -> tracked model-overrides.json
//   node scripts/sync-settings.ts reset   normalize the live settings in place
//                                         apply tracked model-overrides.json to the live models.json
//
// Entries belonging to this repo (main checkout paths, worktree paths, or the git source) are
// replaced with one canonical local-path entry per package referenced by the root Pi manifest. All
// other entries and settings pass through untouched.
//
// Only `providers.<name>.modelOverrides` is copied out of `models.json`. Endpoints, API keys, and
// model lists stay machine-local and are never written into this repository.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyModelOverrides,
  extractModelOverrides,
  isModelOverrides,
  isRecord,
} from "./model-overrides.ts";

type Settings = { packages: string[] } & Record<string, unknown>;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const liveSettingsPath = join(homedir(), ".pi", "agent", "settings.json");
const trackedSettingsPath = join(repoRoot, "settings.json");
const liveModelsPath = join(homedir(), ".pi", "agent", "models.json");
const trackedOverridesPath = join(repoRoot, "model-overrides.json");

const GIT_SOURCE = "git:github.com/osolmaz/onurpi";
const REMOVED_OR_REPLACED_PACKAGE_SOURCES = [
  // Keep retired Goal sources here so synchronization removes old direct installations.
  /^git:github\.com\/Michaelliv\/pi-goal(?:@.*)?$/,
  /^npm:pi-goal(?:@.*)?$/,
  /^npm:pi-unified-exec(?:@.*)?$/,
  /^npm:@narumitw\/pi-usage(?:@.*)?$/,
  /^npm:@narumitw\/pi-tui-kit(?:@.*)?$/,
  /^npm:pi-huggingface-oauth(?:@.*)?$/,
  /^npm:@osolmaz\/pi-workflows(?:@.*)?$/,
  /^git:github\.com\/osolmaz\/pi-workflows(?:@.*)?$/,
  /^git:github\.com\/osolmaz\/pi-must-win(?:@.*)?$/,
  /^npm:pi-must-win(?:@.*)?$/,
  /^npm:pi-regraft(?:@.*)?$/,
  /^git:github\.com\/osolmaz\/pi-demo-mode(?:@.*)?$/,
  /^npm:pi-demo-mode(?:@.*)?$/,
];
const RESOURCE_TYPES = ["extensions", "skills", "prompts", "themes"] as const;
const CANONICAL_REPO_ROOT = resolve(dirname(liveSettingsPath), "..", "..", "repos", "onurpi");
const WORKTREES_ROOT = resolve(CANONICAL_REPO_ROOT, "..", "onurpi-worktrees");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** `models.json` is optional in Pi, so a missing file is a normal state, not an error. */
function readJsonIfPresent(path: string): unknown {
  return existsSync(path) ? readJson(path) : undefined;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function isSettings(value: unknown): value is Settings {
  return isRecord(value) && Array.isArray(value["packages"]);
}

function canonicalEntries(): string[] {
  const manifest = readJson(join(repoRoot, "package.json"));
  const piManifest: unknown = (manifest as { pi?: unknown }).pi;
  if (!isResourceManifest(piManifest)) throw new Error("Root manifest is missing Pi resources");

  const packageNames = new Set<string>();
  for (const resourceType of RESOURCE_TYPES) {
    for (const name of packageNamesForResource(piManifest[resourceType], resourceType)) {
      packageNames.add(name);
    }
  }

  return [...packageNames].map((name) => `../../repos/onurpi/packages/${name}`);
}

function packageNamesForResource(entries: unknown, resourceType: string): string[] {
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) throw new Error(`Non-array pi.${resourceType}`);
  return entries.flatMap((entry) => {
    if (typeof entry !== "string") throw new Error(`Non-string entry in pi.${resourceType}`);
    const match = /^\.\/packages\/([^/]+)\//.exec(entry);
    if (match?.[1]) return [match[1]];
    throw new Error(`Every pi.${resourceType} entry must belong to packages/<name>: ${entry}`);
  });
}

function isResourceManifest(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOurs(entry: string): boolean {
  if (
    entry === GIT_SOURCE ||
    REMOVED_OR_REPLACED_PACKAGE_SOURCES.some((pattern) => pattern.test(entry))
  ) {
    return true;
  }
  if (entry.startsWith("npm:") || entry.startsWith("git:") || entry.includes("://")) return false;
  const absolute = resolve(dirname(liveSettingsPath), entry);
  return (
    absolute === CANONICAL_REPO_ROOT ||
    absolute.startsWith(`${CANONICAL_REPO_ROOT}/`) ||
    absolute.startsWith(`${WORKTREES_ROOT}/`)
  );
}

function normalize(settings: Settings): Settings {
  const kept = settings.packages.filter((entry) => !isOurs(entry));
  return { ...settings, packages: [...kept, ...canonicalEntries()] };
}

const mode = process.argv[2];
const live = readJson(liveSettingsPath);
if (!isSettings(live)) throw new Error(`No packages array in ${liveSettingsPath}`);

if (mode === "sync") {
  writeJson(trackedSettingsPath, normalize(live));
  console.log(`Wrote normalized settings to ${trackedSettingsPath}`);

  const overrides = extractModelOverrides(readJsonIfPresent(liveModelsPath));
  writeJson(trackedOverridesPath, overrides);
  console.log(`Wrote model overrides to ${trackedOverridesPath}`);
} else if (mode === "reset") {
  writeJson(liveSettingsPath, normalize(live));
  console.log(`Reset repo entries in ${liveSettingsPath}`);

  const tracked: unknown = readJson(trackedOverridesPath);
  if (!isModelOverrides(tracked))
    throw new Error(`Invalid model overrides in ${trackedOverridesPath}`);
  writeJson(
    liveModelsPath,
    applyModelOverrides(readJsonIfPresent(liveModelsPath) ?? {}, tracked, liveModelsPath),
  );
  console.log(`Applied model overrides to ${liveModelsPath}`);
} else {
  console.error("Usage: sync-settings.ts <sync|reset>");
  process.exit(1);
}
