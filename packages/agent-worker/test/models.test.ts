import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MODEL_PROVIDERS } from "../src/config.ts";
import { echoProvider, workerModels } from "../src/models.ts";

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { force: true, recursive: true });
});

describe("echoProvider", () => {
  it("always has an answer ready", () => {
    expect(echoProvider().getPendingResponseCount()).toBe(1);
  });
});

describe("workerModels", () => {
  it.each(MODEL_PROVIDERS)("sets up the %s provider without a network call", (provider) => {
    const agentDir = mkdtempSync(join(tmpdir(), "agent-worker-pi-"));
    folders.push(agentDir);
    const created = workerModels({ modelId: "test-model", provider }, agentDir);
    expect(created.models.getProvider(provider)?.id).toBe(provider);
    created.close();
  });
});
