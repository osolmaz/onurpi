import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadReviewerApp } from "../src/app.js";
import { listReviewerModels } from "../src/models.js";

const cleanup: string[] = [];
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

describe("review model listing", () => {
  it("uses the app model catalog with its resolved auth profile", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-reviewer-models-"));
    cleanup.push(root);
    vi.stubEnv("PI_FACTORY_STATE_DIR", path.join(root, "factory"));
    const loaded = await loadReviewerApp({ packageRoot, piCommand: [process.execPath] });
    const stateDir = path.join(root, "reviewer");
    const app = {
      ...loaded,
      stateDir,
      sessionDir: path.join(stateDir, "sessions"),
    };
    const configDir = path.join(stateDir, "pi-config-runtime");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, "auth.json"),
      JSON.stringify({ anthropic: { type: "api_key", key: "test-key" } }),
      { mode: 0o600 },
    );

    const models = await listReviewerModels(app, "claude");
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((model) => model.startsWith("anthropic/"))).toBe(true);
  });
});
