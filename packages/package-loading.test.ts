import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const resourceTypes = ["extensions", "skills", "prompts", "themes"] as const;

function readJson(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(join(root, path), "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object");
  }
  return value as Record<string, unknown>;
}

function resourceManifest(): Record<string, unknown> {
  const manifest = readJson("package.json");
  const pi = manifest["pi"];
  if (typeof pi !== "object" || pi === null || Array.isArray(pi)) {
    throw new Error("Expected a Pi manifest");
  }
  return pi as Record<string, unknown>;
}

function resourceEntries(): string[] {
  const pi = resourceManifest();
  return resourceTypes.flatMap((resourceType) => {
    const entries = pi[resourceType];
    if (entries === undefined) return [];
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")) {
      throw new Error(`Expected string entries in pi.${resourceType}`);
    }
    return entries as string[];
  });
}

function packageName(entry: string): string {
  const match = /^\.\/packages\/([^/]+)\//u.exec(entry);
  if (!match?.[1]) throw new Error(`Resource is outside packages/<name>: ${entry}`);
  return match[1];
}

function resourceEntryExists(entry: string): boolean {
  const wildcard = entry.indexOf("*");
  const path = wildcard < 0 ? entry : entry.slice(0, wildcard);
  return existsSync(join(root, path));
}

const externalPackages = [
  {
    directory: "demo-mode",
    dependency: "pi-demo-mode",
    source:
      "https://codeload.github.com/osolmaz/pi-demo-mode/tar.gz/8f18a3802a786be797404eb0a4ee3cce8a522b75",
  },
  {
    directory: "huggingface-oauth",
    dependency: "pi-huggingface-oauth",
    source: "0.2.0",
  },
  {
    directory: "pi-must-win",
    dependency: "pi-must-win",
    source: "0.5.0",
  },
  {
    directory: "regrafter-driver",
    dependency: "pi-regraft",
    source: "0.5.1",
  },
  {
    directory: "workflows",
    dependency: "@osolmaz/pi-workflows",
    source: "0.16.0",
  },
] as const;

describe("OnurPi package loading", () => {
  it("keeps every root resource inside an independent package", () => {
    for (const entry of resourceEntries()) {
      const directory = packageName(entry);
      expect(existsSync(join(root, "packages", directory, "package.json"))).toBe(true);
      expect(resourceEntryExists(entry)).toBe(true);
    }
  });

  it("tracks every root package exactly once in canonical settings", () => {
    const settings = readJson("settings.json");
    const packages = settings["packages"];
    if (!Array.isArray(packages)) throw new Error("Expected settings packages");
    const expected = [...new Set(resourceEntries().map(packageName))].map(
      (name) => `../../repos/onurpi/packages/${name}`,
    );

    for (const entry of expected) {
      expect(packages.filter((value) => value === entry)).toHaveLength(1);
    }
    expect(
      packages.filter((value) => typeof value === "string" && value.includes("onurpi")),
    ).toEqual(expected);
  });

  it("pins external extensions in private wrapper packages", () => {
    const rootManifest = readJson("package.json");
    expect(rootManifest["dependencies"]).toBeUndefined();
    expect(rootManifest["bundledDependencies"]).toBeUndefined();

    for (const externalPackage of externalPackages) {
      const manifest = readJson(`packages/${externalPackage.directory}/package.json`);
      expect(manifest["private"]).toBe(true);
      expect(manifest["dependencies"]).toMatchObject({
        [externalPackage.dependency]: externalPackage.source,
      });
      expect(existsSync(join(root, "packages", externalPackage.directory, "UPSTREAM.md"))).toBe(
        true,
      );
    }
  });

  it("keeps workflow plugin synchronization explicit", () => {
    const rootManifest = readJson("package.json");
    const rootScripts = rootManifest["scripts"];
    if (typeof rootScripts !== "object" || rootScripts === null || Array.isArray(rootScripts)) {
      throw new Error("Expected root scripts");
    }
    const workflowsManifest = readJson("packages/workflows/package.json");
    const workflowsScripts = workflowsManifest["scripts"];
    if (
      typeof workflowsScripts !== "object" ||
      workflowsScripts === null ||
      Array.isArray(workflowsScripts)
    ) {
      throw new Error("Expected workflow scripts");
    }

    expect((rootScripts as Record<string, unknown>)["workflows:sync"]).toBe(
      "npm run sync --workspace @onurpi/workflows",
    );
    expect((workflowsScripts as Record<string, unknown>)["sync"]).toBe("node sync.ts");
    expect((rootScripts as Record<string, unknown>)["postinstall"]).toBeUndefined();
    expect((workflowsScripts as Record<string, unknown>)["postinstall"]).toBeUndefined();
  });

  it("removes standalone sources replaced by wrappers", () => {
    const settings = readJson("settings.json");
    const packages = settings["packages"];
    expect(packages).not.toEqual(
      expect.arrayContaining([
        "npm:pi-huggingface-oauth@0.1.1",
        "npm:@osolmaz/pi-workflows@0.2.0",
        "git:github.com/osolmaz/pi-workflows",
        "git:github.com/osolmaz/pi-must-win",
        "npm:pi-must-win",
        "npm:pi-regraft@0.4.0",
        "git:github.com/osolmaz/pi-demo-mode",
      ]),
    );
  });

  it("removes the scoped workflow source during live settings migration", () => {
    const home = mkdtempSync(join(tmpdir(), "onurpi-settings-"));
    try {
      const settingsPath = join(home, ".pi", "agent", "settings.json");
      mkdirSync(join(home, ".pi", "agent"), { recursive: true });
      writeFileSync(
        settingsPath,
        `${JSON.stringify({ packages: ["npm:@osolmaz/pi-workflows@0.2.0", "npm:third-party"] })}\n`,
      );
      execFileSync(process.execPath, [join(root, "scripts", "sync-settings.ts"), "reset"], {
        env: { ...process.env, HOME: home, USERPROFILE: home },
      });
      const normalized: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
      if (typeof normalized !== "object" || normalized === null || Array.isArray(normalized)) {
        throw new Error("Expected normalized settings");
      }
      const packages = (normalized as { packages?: unknown }).packages;
      expect(packages).toEqual(expect.arrayContaining(["npm:third-party"]));
      expect(packages).not.toEqual(expect.arrayContaining(["npm:@osolmaz/pi-workflows@0.2.0"]));
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("loads Prompt Queue before Turn Fold so the shortcut wraps the active editor", () => {
    const extensions = resourceManifest()["extensions"];
    if (!Array.isArray(extensions)) throw new Error("Expected extension entries");
    expect(extensions.indexOf("./packages/prompt-queue/index.ts")).toBeLessThan(
      extensions.indexOf("./packages/turn-fold/index.ts"),
    );
  });

  it("loads Codex routing, timing, native content, and text fallback in order", () => {
    const extensions = resourceManifest()["extensions"];
    if (!Array.isArray(extensions)) throw new Error("Expected extension entries");
    const switcher = extensions.indexOf("./packages/codex-switcher/index.ts");
    const policy = extensions.indexOf("./packages/context-window-policy/index.ts");
    const codex = extensions.indexOf("./packages/pi-codex-compaction/index.ts");
    expect(switcher).toBeGreaterThanOrEqual(0);
    expect(switcher).toBeLessThan(policy);
    expect(policy).toBeLessThan(codex);
    expect(codex).toBeLessThan(extensions.indexOf("./packages/reliable-compaction/index.ts"));
  });

  it("runs Loop Guard before Goal settlement handlers", () => {
    const extensions = resourceManifest()["extensions"];
    if (!Array.isArray(extensions)) throw new Error("Expected extension entries");
    expect(extensions.indexOf("./packages/loop-guard/index.ts")).toBeLessThan(
      extensions.indexOf("./packages/goal/index.ts"),
    );
  });

  it("registers the Regrafter extension and optional driver skill", () => {
    const pi = resourceManifest();
    expect(pi["extensions"]).toContain("./packages/regrafter-driver/index.ts");
    expect(pi["skills"]).toContain("./packages/regrafter-driver/skills");
    const nestedBin = join(
      root,
      "packages",
      "regrafter-driver",
      "node_modules",
      ".bin",
      "regrafter",
    );
    const hoistedBin = join(root, "node_modules", ".bin", "regrafter");
    expect(existsSync(nestedBin) || existsSync(hoistedBin)).toBe(true);
  });
});
