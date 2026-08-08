import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { writePiRuntimeConfig } from "@osolmaz/pi-factory";
import { afterEach, describe, expect, it } from "vitest";

import { selectAppModel } from "../src/app.js";
import { loadCustomModelManifest } from "../src/model-manifest.js";
import type { ModelSelection } from "../src/types.js";

const directories: string[] = [];
const selection: ModelSelection = {
  provider: "huggingface",
  model: "deepseek-ai/DeepSeek-V4-Flash-0731:together",
  thinking: "high",
};

async function rawManifestFile(content: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-reviewer-model-"));
  directories.push(directory);
  const file = path.join(directory, "model.json");
  await writeFile(file, content);
  return file;
}

async function manifestFile(value: unknown): Promise<string> {
  return await rawManifestFile(JSON.stringify(value));
}

function validManifest(): Readonly<Record<string, unknown>> {
  return {
    version: 1,
    provider: {
      id: "huggingface",
      baseUrl: "https://router.huggingface.co/v1",
      apiKeyEnv: "HF_TOKEN",
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    },
    model: {
      id: "deepseek-ai/DeepSeek-V4-Flash-0731:together",
      name: "DeepSeek V4 Flash 0731 · Together",
      reasoning: true,
      thinkingFormat: "deepseek",
      input: ["text", "image"],
      contextWindow: 1_048_576,
      maxTokens: 384_000,
      cost: { input: 0.14, output: 0.28, cacheRead: 0, cacheWrite: 0 },
    },
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true });
    }),
  );
});

describe("custom model manifest", () => {
  it("loads a strict manifest and configures a custom Pi provider", async () => {
    const file = await manifestFile(validManifest());
    const manifest = await loadCustomModelManifest(file, selection);
    const stateDirectory = path.join(path.dirname(file), "state");
    const app = selectAppModel(
      {
        id: "reviewer",
        name: "Reviewer",
        stateDir: stateDirectory,
        sessionDir: path.join(stateDirectory, "sessions"),
        piCommand: ["pi"],
        providers: [],
        defaultProvider: "unconfigured",
        defaultModel: "unconfigured",
        thinking: "high",
      },
      selection,
      manifest,
    );

    expect(app.providers).toEqual([
      {
        id: "huggingface",
        source: "custom",
        baseUrl: "https://router.huggingface.co/v1",
        api: "openai-completions",
        apiKey: "$HF_TOKEN",
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
        models: [manifest.model],
      },
    ]);
    expect(app.defaultModel).toBe(selection.model);

    const runtimeConfig = await writePiRuntimeConfig(app);
    const runtime = await ModelRuntime.create({
      authPath: path.join(app.stateDir, "auth.json"),
      modelsPath: runtimeConfig.modelsPath,
      modelsStorePath: path.join(app.stateDir, "models-store.json"),
      allowModelNetwork: false,
    });
    expect(runtime.getModel(selection.provider, selection.model)).toMatchObject({
      id: selection.model,
      provider: selection.provider,
      contextWindow: 1_048_576,
      maxTokens: 384_000,
    });
  });

  it("accepts a manifest without optional fields", async () => {
    const manifest = await loadCustomModelManifest(
      await manifestFile({
        version: 1,
        provider: { id: selection.provider, baseUrl: "https://example.test/v1" },
        model: { id: selection.model },
      }),
      selection,
    );

    expect(manifest).toEqual({
      version: 1,
      provider: { id: selection.provider, baseUrl: "https://example.test/v1" },
      model: { id: selection.model },
    });
  });

  it("rejects mismatches, unknown fields, insecure URLs, and invalid costs", async () => {
    await expect(
      loadCustomModelManifest(await manifestFile({ ...validManifest(), unknown: true }), selection),
    ).rejects.toThrow("unknown field");
    await expect(
      loadCustomModelManifest(
        await manifestFile({
          ...validManifest(),
          provider: { id: "huggingface", baseUrl: "http://example.test/v1" },
        }),
        selection,
      ),
    ).rejects.toThrow("HTTPS");
    await expect(
      loadCustomModelManifest(
        await manifestFile({
          ...validManifest(),
          model: {
            id: selection.model,
            cost: { input: -1, output: 1, cacheRead: 0, cacheWrite: 0 },
          },
        }),
        selection,
      ),
    ).rejects.toThrow("nonnegative");
    await expect(
      loadCustomModelManifest(await manifestFile(validManifest()), {
        ...selection,
        model: "other/model",
      }),
    ).rejects.toThrow("does not match");
  });

  it("rejects malformed and out-of-bounds manifest values", async () => {
    const cases: readonly (readonly [unknown, string])[] = [
      [null, "must be an object"],
      [{ ...validManifest(), version: 2 }, "version must be 1"],
      [{ ...validManifest(), provider: [] }, "provider must be an object"],
      [{ ...validManifest(), provider: { id: "huggingface", baseUrl: "not a URL" } }, "valid URL"],
      [
        {
          ...validManifest(),
          provider: {
            id: "huggingface",
            baseUrl: "https://example.test",
            apiKeyEnv: "lowercase",
          },
        },
        "environment variable name",
      ],
      [
        {
          ...validManifest(),
          provider: {
            id: "huggingface",
            baseUrl: "https://example.test",
            compat: { supportsDeveloperRole: "no" },
          },
        },
        "must be a boolean",
      ],
      [
        { ...validManifest(), model: { id: selection.model, thinkingFormat: "other" } },
        "thinkingFormat is unsupported",
      ],
      [
        { ...validManifest(), model: { id: selection.model, input: [] } },
        "input must be non-empty",
      ],
      [
        { ...validManifest(), model: { id: selection.model, input: ["audio"] } },
        "unsupported type",
      ],
      [
        { ...validManifest(), model: { id: selection.model, contextWindow: 1.5 } },
        "positive integer",
      ],
      [{ ...validManifest(), model: { id: "" } }, "non-empty bounded string"],
    ];
    for (const [value, message] of cases) {
      await expect(loadCustomModelManifest(await manifestFile(value), selection)).rejects.toThrow(
        message,
      );
    }
    await expect(loadCustomModelManifest(await rawManifestFile("{"), selection)).rejects.toThrow(
      "valid JSON",
    );
    await expect(
      loadCustomModelManifest(await rawManifestFile("x".repeat(64 * 1024 + 1)), selection),
    ).rejects.toThrow("too large");
  });
});
