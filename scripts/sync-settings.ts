// Normalize Pi package entries for this repo.
//
//   node scripts/sync-settings.ts sync    live settings -> tracked settings.json (normalized)
//   node scripts/sync-settings.ts reset   normalize the live settings in place
//
// Entries belonging to this repo (main checkout paths, worktree paths, or the git source) are
// replaced with one canonical local-path entry per package derived from the root manifest. All
// other entries and settings pass through untouched.

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Settings = { packages: string[] } & Record<string, unknown>;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const liveSettingsPath = join(homedir(), ".pi", "agent", "settings.json");
const trackedSettingsPath = join(repoRoot, "settings.json");

const GIT_SOURCE = "git:github.com/osolmaz/onurpi";
const REPLACED_PACKAGE_SOURCES = [/^npm:pi-unified-exec(?:@.*)?$/];
const CANONICAL_REPO_ROOT = resolve(dirname(liveSettingsPath), "..", "..", "repos", "onurpi");
const WORKTREES_ROOT = resolve(CANONICAL_REPO_ROOT, "..", "onurpi-worktrees");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function isSettings(value: unknown): value is Settings {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { packages?: unknown }).packages)
  );
}

function canonicalEntries(): string[] {
  const manifest = readJson(join(repoRoot, "package.json"));
  const extensions: unknown = (manifest as { pi?: { extensions?: unknown } }).pi?.extensions;
  if (!Array.isArray(extensions)) throw new Error("Root manifest is missing pi.extensions");
  return extensions.map((entry) => {
    if (typeof entry !== "string") throw new Error("Non-string entry in pi.extensions");
    const match = /^\.\/packages\/([^/]+)\//.exec(entry);
    if (!match?.[1]) throw new Error(`Unexpected pi.extensions entry: ${entry}`);
    return `../../repos/onurpi/packages/${match[1]}`;
  });
}

function isOurs(entry: string): boolean {
  if (entry === GIT_SOURCE || REPLACED_PACKAGE_SOURCES.some((pattern) => pattern.test(entry))) {
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
} else if (mode === "reset") {
  writeJson(liveSettingsPath, normalize(live));
  console.log(`Reset repo entries in ${liveSettingsPath}`);
} else {
  console.error("Usage: sync-settings.ts <sync|reset>");
  process.exit(1);
}
