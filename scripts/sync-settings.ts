// Keep the tracked copies of global Pi configuration in step with the live agent directory.
//
//   node scripts/sync-settings.ts sync    converge the live and tracked copies. A change made on
//                                         the repository side reaches this machine, and a change
//                                         made on the machine is recorded in this repository.
//   node scripts/sync-settings.ts reset   make the live files match the tracked copies, discarding
//                                         live changes to reviewed settings.
//
// A converge merges against the base recorded by the previous run, so it can tell a one-sided
// change from a conflict. A key that both sides changed differently stops the run, writes nothing,
// and exits non-zero; set the live value, take the live value with `sync --adopt-live`, or apply the
// repository values with `reset`.
//
// Entries belonging to this repo (main checkout paths, worktree paths, or the git source) are
// replaced with one canonical local-path entry per package referenced by the root Pi manifest. All
// other entries and settings pass through untouched.
//
// Only `providers.<name>.modelOverrides` is copied out of `models.json`. Endpoints, API keys, and
// model lists stay machine-local and are never written into this repository. The same rule applies
// to `web-search.json`, which is also a credential store: only the reviewed, non-secret settings
// from `TRACKED_KEYS` are copied. The keys in `LOCAL_ONLY_KEYS` stay out of the tracked
// `settings.json` in the same way.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { differingKeys, isEqual, mergeThreeWay, type ConflictPolicy } from "./json-merge.ts";
import {
  applyModelOverrides,
  extractModelOverrides,
  isModelOverrides,
  isRecord,
  type ModelOverrides,
} from "./model-overrides.ts";
import { adoptTracked, applySettingsChanges, stripLocalOnly } from "./settings-file.ts";
import { applyWebSearchSettings, extractWebSearchSettings } from "./web-search-config.ts";

type Settings = { packages: string[] } & Record<string, unknown>;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const liveSettingsPath = join(homedir(), ".pi", "agent", "settings.json");
const trackedSettingsPath = join(repoRoot, "settings.json");
const liveModelsPath = join(homedir(), ".pi", "agent", "models.json");
const trackedOverridesPath = join(repoRoot, "model-overrides.json");
const liveWebSearchPath = join(homedir(), ".pi", "agent", "web-search.json");
const trackedWebSearchPath = join(repoRoot, "web-search.json");

const GIT_SOURCE = "git:github.com/osolmaz/onurpi";
const REMOVED_OR_REPLACED_PACKAGE_SOURCES = [
  // Keep retired Goal sources here so synchronization removes old direct installations.
  /^git:github\.com\/Michaelliv\/pi-goal(?:@.*)?$/,
  /^npm:pi-goal(?:@.*)?$/,
  /^npm:pi-unified-exec(?:@.*)?$/,
  /^npm:@narumitw\/pi-btw(?:@.*)?$/,
  /^npm:@narumitw\/pi-usage(?:@.*)?$/,
  /^npm:@narumitw\/pi-tui-kit(?:@.*)?$/,
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

/** The repository-owned package an entry names, for comparing entry sets across spellings. */
function packageNameOf(entry: string): string {
  const absolute = resolve(dirname(liveSettingsPath), entry);
  const worktreeMatch = absolute.startsWith(`${WORKTREES_ROOT}/`)
    ? /\/packages\/([^/]+)/.exec(absolute.slice(WORKTREES_ROOT.length))
    : undefined;
  if (worktreeMatch?.[1]) return worktreeMatch[1];
  const canonicalPrefix = `${CANONICAL_REPO_ROOT}/packages/`;
  if (absolute.startsWith(canonicalPrefix))
    return absolute.slice(canonicalPrefix.length).split("/")[0] ?? entry;
  return entry;
}

/**
 * The merge compares canonical views, so a package added to the root manifest changes the reviewed
 * part without changing any live value the merge could apply. When the merge actually changed the
 * reviewed package list against the recorded base, append the reviewed entries the live file does
 * not name yet, and keep the rest of the raw document, including worktree spellings.
 */
function reconcilePackages(
  liveRaw: Record<string, unknown>,
  reviewed: Record<string, unknown>,
  base: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const reviewedPackages = Array.isArray(reviewed["packages"])
    ? (reviewed["packages"] as string[])
    : [];
  const rawPackages = Array.isArray(liveRaw["packages"]) ? (liveRaw["packages"] as string[]) : [];
  const basePackages = Array.isArray(base?.["packages"])
    ? (base?.["packages"] as string[])
    : undefined;
  const packagesChanged = basePackages === undefined || !isEqual(basePackages, reviewedPackages);
  if (!packagesChanged) return liveRaw;
  const rawNames = new Set(rawPackages.filter(isOurs).map(packageNameOf));
  const added = reviewedPackages.filter(
    (entry) => isOurs(entry) && !rawNames.has(packageNameOf(entry)),
  );
  if (added.length === 0) return liveRaw;
  return { ...liveRaw, packages: [...rawPackages, ...added] };
}

const SYNC_BASE_VERSION = 1;
const SYNC_BASE_PATH = join(homedir(), ".pi", "agent", ".onurpi-sync-base.json");

/** The reviewed part of each live file, in the shape the tracked copies use. */
type Documents = {
  settings: Record<string, unknown>;
  modelOverrides: ModelOverrides;
  webSearch: Record<string, unknown>;
};

type SyncBase = Documents & { version: number };

type Converged = { ok: true; documents: Documents } | { ok: false };

function isSyncBase(value: unknown): value is SyncBase {
  if (!isRecord(value)) return false;
  if (value["version"] !== SYNC_BASE_VERSION) return false;
  if (!isRecord(value["settings"])) return false;
  if (!isModelOverrides(value["modelOverrides"])) return false;
  return isRecord(value["webSearch"]);
}

function readSyncBase(): SyncBase | undefined {
  if (!existsSync(SYNC_BASE_PATH)) return undefined;
  const stored = readJson(SYNC_BASE_PATH);
  if (!isSyncBase(stored)) throw new Error(`Invalid sync base in ${SYNC_BASE_PATH}`);
  return stored;
}

function syncBaseFrom(documents: Documents): SyncBase {
  return {
    version: SYNC_BASE_VERSION,
    settings: documents.settings,
    modelOverrides: documents.modelOverrides,
    webSearch: documents.webSearch,
  };
}

/** Write only when the formatted content changes, so an unchanged file keeps its exact bytes. */
function writeJsonIfChanged(path: string, value: unknown): void {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (current === next) return;
  writeFileSync(path, next);
}

/** Read a settings document and replace its repo-owned entries with the canonical ones. */
function trackedSettings(value: unknown, label: string): Settings {
  if (!isSettings(value)) throw new Error(`No packages array in ${label}`);
  return normalize(value);
}

/**
 * Read the live settings as the machine holds them. A write must keep that document intact,
 * including package entries that point into a development worktree, so the raw document is
 * returned alongside the canonical view the merge compares.
 */
function readLiveSettingsDocument(): Settings {
  const value = readJson(liveSettingsPath);
  if (!isSettings(value)) throw new Error(`No packages array in ${liveSettingsPath}`);
  return value;
}

function readTrackedOverrides(): ModelOverrides {
  const stored = readJson(trackedOverridesPath);
  if (!isModelOverrides(stored))
    throw new Error(`Invalid model overrides in ${trackedOverridesPath}`);
  return stored;
}

function readTrackedWebSearch(): Record<string, unknown> {
  const stored = readJson(trackedWebSearchPath);
  if (!isRecord(stored)) throw new Error(`Invalid web search settings in ${trackedWebSearchPath}`);
  return stored;
}

function documentsAgree(left: Documents, right: Documents): boolean {
  return (
    isEqual(left.settings, right.settings) &&
    isEqual(left.modelOverrides, right.modelOverrides) &&
    isEqual(left.webSearch, right.webSearch)
  );
}

function reportChanges(label: string, live: unknown, tracked: unknown, merged: unknown): void {
  const applied = differingKeys(live, merged);
  const recorded = differingKeys(tracked, merged);
  if (applied.length === 0 && recorded.length === 0) {
    console.log(`${label}: in sync`);
    return;
  }
  if (applied.length > 0) console.log(`${label}: repo -> live: ${applied.join(", ")}`);
  if (recorded.length > 0) console.log(`${label}: live -> repo: ${recorded.join(", ")}`);
}

function reportDivergence(label: string, live: unknown, tracked: unknown): void {
  const keys = differingKeys(live, tracked);
  if (keys.length > 0) console.error(`  ${label}: ${keys.join(", ")}`);
}

/**
 * Without a recorded base, a difference cannot be attributed to one side, so the run stops and the
 * user picks a direction. Guessing here would silently discard one of the two states.
 */
function reportMissingBase(): void {
  console.error(`No sync base in ${SYNC_BASE_PATH}, and the live and tracked copies differ:`);
  reportDivergence("settings.json", liveDocuments.settings, trackedDocuments.settings);
  reportDivergence(
    "model-overrides.json",
    liveDocuments.modelOverrides,
    trackedDocuments.modelOverrides,
  );
  reportDivergence("web-search.json", liveDocuments.webSearch, trackedDocuments.webSearch);
  console.error(
    "Apply the repository values with `npm run settings:reset`, or record this machine's values " +
      "with `npm run settings:sync --adopt-live`.",
  );
}

function reportConflicts(conflicts: string[]): void {
  console.error("Conflicting changes:");
  for (const conflict of conflicts) console.error(`  ${conflict}`);
  console.error(
    "Nothing was written. Set the live value, take the live value with " +
      "`npm run settings:sync --adopt-live`, or apply the repository values with " +
      "`npm run settings:reset`.",
  );
}

/** The artifacts that travel between the live agent directory and this repository. */
const ARTIFACTS = [
  ["settings.json", "settings"],
  ["model-overrides.json", "modelOverrides"],
  ["web-search.json", "webSearch"],
] as const;

type ArtifactKey = (typeof ARTIFACTS)[number][1];

/** Merge every artifact against the base and label each conflict with its artifact. */
function mergeAll(
  base: SyncBase,
  onConflict: ConflictPolicy,
): { documents: Record<ArtifactKey, unknown>; conflicts: string[] } {
  const documents = {} as Record<ArtifactKey, unknown>;
  const conflicts: string[] = [];
  for (const [label, key] of ARTIFACTS) {
    const result = mergeThreeWay(base[key], liveDocuments[key], trackedDocuments[key], {
      onConflict,
    });
    documents[key] = result.value;
    conflicts.push(...result.conflicts.map((path) => `${label}: ${path}`));
  }
  return { documents, conflicts };
}

function asDocuments(documents: Record<ArtifactKey, unknown>): Documents {
  const { settings, modelOverrides, webSearch } = documents;
  if (!isRecord(settings) || !isModelOverrides(modelOverrides) || !isRecord(webSearch)) {
    throw new Error("The merge produced an invalid document");
  }
  return { settings, modelOverrides, webSearch };
}

function converge(base: SyncBase | undefined): Converged {
  if (base === undefined) {
    if (adoptLive || documentsAgree(liveDocuments, trackedDocuments)) {
      return { ok: true, documents: liveDocuments };
    }
    reportMissingBase();
    return { ok: false };
  }

  const { documents, conflicts } = mergeAll(base, adoptLive ? "live" : "fail");
  if (conflicts.length > 0) {
    reportConflicts(conflicts);
    return { ok: false };
  }
  return { ok: true, documents: asDocuments(documents) };
}

function runSync(): void {
  const base = readSyncBase();
  const merged = converge(base);
  if (!merged.ok) process.exit(1);
  const { settings, modelOverrides, webSearch } = merged.documents;

  reportChanges("settings.json", liveDocuments.settings, trackedDocuments.settings, settings);
  reportChanges(
    "model-overrides.json",
    liveDocuments.modelOverrides,
    trackedDocuments.modelOverrides,
    modelOverrides,
  );
  reportChanges("web-search.json", liveDocuments.webSearch, trackedDocuments.webSearch, webSearch);

  writeJsonIfChanged(trackedSettingsPath, trackedSettings(settings, "the merged settings"));
  writeJsonIfChanged(
    liveSettingsPath,
    reconcilePackages(
      applySettingsChanges(liveSettingsDocument, liveDocuments.settings, settings),
      settings,
      base?.settings,
    ),
  );
  writeJsonIfChanged(trackedOverridesPath, modelOverrides);
  writeJsonIfChanged(trackedWebSearchPath, webSearch);

  // The live files are only rewritten when the merge changed their reviewed part, so a live entry
  // that points into a worktree survives a run that has nothing to apply to it.
  if (!isEqual(liveDocuments.modelOverrides, modelOverrides)) {
    writeJsonIfChanged(
      liveModelsPath,
      applyModelOverrides(liveModels ?? {}, modelOverrides, liveModelsPath),
    );
  }
  if (!isEqual(liveDocuments.webSearch, webSearch)) {
    writeJsonIfChanged(
      liveWebSearchPath,
      applyWebSearchSettings(liveWebSearch, webSearch, trackedWebSearchPath),
    );
  }

  writeJsonIfChanged(SYNC_BASE_PATH, syncBaseFrom(merged.documents));
  console.log(`Sync base: ${SYNC_BASE_PATH}`);
}

function runReset(): void {
  // Adopting the tracked settings must not drop external package entries that only this machine
  // has, so the live package list is normalized in place instead of coming from the tracked file.
  const adopted = adoptTracked(trackedDocuments.settings, liveSettingsDocument);
  writeJsonIfChanged(liveSettingsPath, { ...adopted, packages: liveSettings.packages });
  writeJsonIfChanged(
    liveModelsPath,
    applyModelOverrides(liveModels ?? {}, trackedDocuments.modelOverrides, liveModelsPath),
  );
  writeJsonIfChanged(
    liveWebSearchPath,
    applyWebSearchSettings(liveWebSearch, trackedDocuments.webSearch, trackedWebSearchPath),
  );
  writeJsonIfChanged(SYNC_BASE_PATH, syncBaseFrom(trackedDocuments));
  console.log(`Settings: repo -> live: ${liveSettingsPath}`);
  console.log(`Model overrides: repo -> live: ${liveModelsPath}`);
  console.log(`Web search: repo -> live: ${liveWebSearchPath}`);
  console.log(`Sync base: ${SYNC_BASE_PATH}`);
}

const mode = process.argv[2];
const adoptLive = process.argv.includes("--adopt-live");

if (mode !== "sync" && mode !== "reset") {
  console.error("Usage: sync-settings.ts <sync|reset> [--adopt-live]");
  process.exit(1);
}

const liveSettingsDocument = readLiveSettingsDocument();
const liveSettings = normalize(liveSettingsDocument);
const liveModels: unknown = readJsonIfPresent(liveModelsPath);
const liveWebSearch: unknown = readJsonIfPresent(liveWebSearchPath);

const liveDocuments: Documents = {
  settings: stripLocalOnly(liveSettings),
  modelOverrides: extractModelOverrides(liveModels),
  webSearch: extractWebSearchSettings(liveWebSearch),
};
const trackedDocuments: Documents = {
  settings: stripLocalOnly(trackedSettings(readJson(trackedSettingsPath), trackedSettingsPath)),
  modelOverrides: readTrackedOverrides(),
  webSearch: readTrackedWebSearch(),
};

if (mode === "sync") {
  runSync();
} else {
  runReset();
}
