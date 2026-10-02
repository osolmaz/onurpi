import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
/** The root manifest drives the canonical package entries; the rest are the tracked documents. */
const copiedFiles = ["package.json", "settings.json", "model-overrides.json", "web-search.json"];

type Document = Record<string, unknown>;
type Fixture = { repo: string; home: string };

/**
 * Copy the script and the tracked files into a throwaway checkout, so a test that records a live
 * change cannot touch the working tree of this repository.
 */
function withFixture(body: (fixture: Fixture) => void): void {
  const base = mkdtempSync(join(tmpdir(), "onurpi-sync-"));
  const repo = join(base, "onurpi");
  const home = join(base, "home");
  mkdirSync(home, { recursive: true });
  cpSync(join(root, "scripts"), join(repo, "scripts"), { recursive: true });
  for (const file of copiedFiles) copyFileSync(join(root, file), join(repo, file));
  try {
    body({ repo, home });
  } finally {
    rmSync(base, { force: true, recursive: true });
  }
}

function readJson(path: string): Document {
  return JSON.parse(readFileSync(path, "utf8")) as Document;
}

/** The tracked settings are canonical, so they are what the previous run would have recorded. */
function readTrackedSettings(fixture: Fixture): Document {
  return readJson(join(fixture.repo, "settings.json"));
}

function readLiveSettings(fixture: Fixture): Document {
  return readJson(join(fixture.home, ".pi", "agent", "settings.json"));
}

/** Write a document with the exact formatting the script writes, so comparisons stay meaningful. */
function writeLive(fixture: Fixture, document: Document, name = "settings.json"): void {
  const directory = join(fixture.home, ".pi", "agent");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), `${JSON.stringify(document, null, 2)}\n`);
}

function writeBase(fixture: Fixture, settings: Document): void {
  writeLive(
    fixture,
    {
      version: 1,
      settings,
      modelOverrides: readJson(join(fixture.repo, "model-overrides.json")),
      webSearch: readJson(join(fixture.repo, "web-search.json")),
    },
    ".onurpi-sync-base.json",
  );
}

function run(fixture: Fixture, ...args: string[]): { status: number | null; output: string } {
  const result = spawnSync(
    process.execPath,
    [join(fixture.repo, "scripts", "sync-settings.ts"), ...args],
    { env: { ...process.env, HOME: fixture.home, USERPROFILE: fixture.home }, encoding: "utf8" },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function liveSettingsPath(fixture: Fixture): string {
  return join(fixture.home, ".pi", "agent", "settings.json");
}

/** Replace the first repo-owned entry with a worktree path, as a development checkout would. */
function withWorktreeEntry(settings: Document, fixture: Fixture): Document {
  const packages = settings["packages"] as string[];
  const index = packages.findIndex((entry) => entry.startsWith("../../repos/onurpi/packages/"));
  const worktree = join(fixture.home, "repos", "onurpi-worktrees", "dev", "packages", "onur-theme");
  return { ...settings, packages: packages.map((entry, at) => (at === index ? worktree : entry)) };
}

describe("sync-settings.ts", () => {
  it("keeps a worktree package entry when there is nothing to apply", () => {
    withFixture((fixture) => {
      const tracked = readTrackedSettings(fixture);
      writeLive(fixture, withWorktreeEntry(tracked, fixture));
      const before = readFileSync(liveSettingsPath(fixture), "utf8");
      writeBase(fixture, tracked);

      const result = run(fixture, "sync");

      expect(result.status).toBe(0);
      expect(result.output).toContain("settings.json: in sync");
      expect(readFileSync(liveSettingsPath(fixture), "utf8")).toBe(before);
      expect(readFileSync(liveSettingsPath(fixture), "utf8")).toContain("onurpi-worktrees");
    });
  });

  it("delivers a manifest-added package to the live file", () => {
    withFixture((fixture) => {
      const tracked = readTrackedSettings(fixture);
      const stale = {
        ...tracked,
        packages: (tracked["packages"] as string[]).filter(
          (entry) => !entry.endsWith("context-ceiling"),
        ),
      };
      writeLive(fixture, stale);
      writeBase(fixture, stale); // the previous run recorded the list without the package

      const result = run(fixture, "sync");

      expect(result.status).toBe(0);
      expect(readLiveSettings(fixture)["packages"]).toContain(
        "../../repos/onurpi/packages/context-ceiling",
      );
    });
  });

  it("keeps a worktree spelling when a manifest-added package lands", () => {
    withFixture((fixture) => {
      const tracked = readTrackedSettings(fixture);
      const staleLive = withWorktreeEntry(
        {
          ...tracked,
          packages: (tracked["packages"] as string[]).filter(
            (entry) => !entry.endsWith("context-ceiling"),
          ),
        },
        fixture,
      );
      writeLive(fixture, staleLive);
      writeBase(fixture, staleLive); // the previous run recorded the list without the package

      const result = run(fixture, "sync");

      expect(result.status).toBe(0);
      const packages = readLiveSettings(fixture)["packages"] as string[];
      expect(packages).toContain("../../repos/onurpi/packages/context-ceiling");
      expect(packages).toContain(
        join(fixture.home, "repos", "onurpi-worktrees", "dev", "packages", "onur-theme"),
      );
    });
  });

  it("applies a repository change to the live file without a manual edit", () => {
    withFixture((fixture) => {
      const tracked = readTrackedSettings(fixture);
      const stale = { ...tracked, defaultModel: "old/model" };
      writeLive(fixture, stale);
      writeBase(fixture, stale);

      const result = run(fixture, "sync");

      expect(result.status).toBe(0);
      expect(result.output).toContain("settings.json: repo -> live: defaultModel");
      expect(readLiveSettings(fixture)["defaultModel"]).toBe(tracked["defaultModel"]);
      expect(readTrackedSettings(fixture)).toEqual(tracked);
    });
  });

  it("records a live change in the tracked file without touching the live value", () => {
    withFixture((fixture) => {
      const tracked = readTrackedSettings(fixture);
      writeLive(fixture, { ...tracked, defaultModel: "machine/model", lastChangelogVersion: "1" });
      writeBase(fixture, tracked);

      const result = run(fixture, "sync");

      expect(result.status).toBe(0);
      expect(result.output).toContain("settings.json: live -> repo: defaultModel");
      expect(readTrackedSettings(fixture)["defaultModel"]).toBe("machine/model");
      expect(readTrackedSettings(fixture)["lastChangelogVersion"]).toBeUndefined();
      expect(readLiveSettings(fixture)["lastChangelogVersion"]).toBe("1");
    });
  });

  it("keeps the live file when machine-local keys are the only difference", () => {
    withFixture((fixture) => {
      const tracked = readTrackedSettings(fixture);
      const live = { ...tracked, lastChangelogVersion: "0.87.1" };
      writeLive(fixture, live);
      const before = readFileSync(liveSettingsPath(fixture), "utf8");
      writeBase(fixture, tracked);

      const result = run(fixture, "sync");

      expect(result.status).toBe(0);
      expect(readFileSync(liveSettingsPath(fixture), "utf8")).toBe(before);
    });
  });

  it("stops without writing when both sides changed the same key", () => {
    withFixture((fixture) => {
      const tracked = readTrackedSettings(fixture);
      writeLive(fixture, { ...tracked, defaultModel: "machine/model" });
      const before = readFileSync(liveSettingsPath(fixture), "utf8");
      writeBase(fixture, { ...tracked, defaultModel: "old/model" });

      const result = run(fixture, "sync");

      expect(result.status).toBe(1);
      expect(result.output).toContain("settings.json: $.defaultModel");
      expect(result.output).toContain("Nothing was written");
      expect(readFileSync(liveSettingsPath(fixture), "utf8")).toBe(before);
      expect(readTrackedSettings(fixture)).toEqual(tracked);
    });
  });

  it("takes the live value for a conflict when asked", () => {
    withFixture((fixture) => {
      const tracked = readTrackedSettings(fixture);
      writeLive(fixture, { ...tracked, defaultModel: "machine/model" });
      writeBase(fixture, { ...tracked, defaultModel: "old/model" });

      const result = run(fixture, "sync", "--adopt-live");

      expect(result.status).toBe(0);
      expect(result.output).toContain("settings.json: live -> repo: defaultModel");
      expect(readTrackedSettings(fixture)["defaultModel"]).toBe("machine/model");
      expect(readLiveSettings(fixture)["defaultModel"]).toBe("machine/model");
    });
  });

  it("asks for a direction when no base is recorded and the copies differ", () => {
    withFixture((fixture) => {
      const tracked = readTrackedSettings(fixture);
      writeLive(fixture, { ...tracked, theme: "other-theme" });
      const before = readFileSync(liveSettingsPath(fixture), "utf8");

      const result = run(fixture, "sync");

      expect(result.status).toBe(1);
      expect(result.output).toContain("No sync base");
      expect(result.output).toContain("settings.json: theme");
      expect(readFileSync(liveSettingsPath(fixture), "utf8")).toBe(before);
      expect(readTrackedSettings(fixture)).toEqual(tracked);
    });
  });

  it("makes the live file match the repository on reset", () => {
    withFixture((fixture) => {
      const tracked = readTrackedSettings(fixture);
      writeLive(fixture, {
        ...tracked,
        defaultModel: "machine/model",
        lastChangelogVersion: "0.87.1",
      });

      const result = run(fixture, "reset");

      expect(result.status).toBe(0);
      expect(readLiveSettings(fixture)["defaultModel"]).toBe(tracked["defaultModel"]);
      expect(readLiveSettings(fixture)["lastChangelogVersion"]).toBe("0.87.1");
    });
  });

  it("keeps an external package entry on reset", () => {
    withFixture((fixture) => {
      const tracked = readTrackedSettings(fixture);
      const packages = [...(tracked["packages"] as string[]), "npm:third-party"];
      writeLive(fixture, { ...tracked, packages });

      const result = run(fixture, "reset");

      expect(result.status).toBe(0);
      expect(readLiveSettings(fixture)["packages"]).toContain("npm:third-party");
    });
  });

  it("rejects an unknown mode", () => {
    withFixture((fixture) => {
      const result = run(fixture, "nonsense");
      expect(result.status).toBe(1);
      expect(result.output).toContain("Usage: sync-settings.ts");
    });
  });
});
