import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveCodexCliCredential, type CredentialResolution } from "./credential-source.ts";
import extension, {
  createCodexAuthReloadStream,
  isOfficialCodexEndpoint,
  reloadCodexRequestOptions,
} from "./index.ts";

const NOW = Date.UTC(2026, 7, 9);
const directories: string[] = [];
type CodexModel = Model<"openai-codex-responses">;
type CodexStreamSimple = NonNullable<ProviderConfig["streamSimple"]>;

function jwt(accountId: string, marker: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      exp: (NOW + 60_000) / 1000,
      marker,
      "https://api.openai.com/auth": { chatgpt_account_id: accountId },
    }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

function model(baseUrl = "https://chatgpt.com/backend-api"): CodexModel {
  return {
    id: "test-model",
    name: "Test model",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272_000,
    maxTokens: 16_384,
  };
}

function assistant(): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: NOW,
  };
}

function completedStream() {
  const stream = createAssistantMessageEventStream();
  stream.end(assistant());
  return stream;
}

function fakeStream(
  observe: (options: SimpleStreamOptions | undefined) => void,
): CodexStreamSimple {
  return (_model, _context, options) => {
    observe(options);
    return completedStream();
  };
}

async function createAuthFile(accountId: string, accessToken: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "codex-auth-reload-provider-"));
  directories.push(directory);
  const path = join(directory, "auth.json");
  await writeFile(
    path,
    JSON.stringify({ tokens: { access_token: accessToken, account_id: accountId } }),
  );
  return path;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("isOfficialCodexEndpoint", () => {
  it.each(["https://chatgpt.com/backend-api", "https://chatgpt.com/backend-api/"])(
    "accepts %s",
    (baseUrl) => {
      expect(isOfficialCodexEndpoint(model(baseUrl))).toBe(true);
    },
  );

  it.each([
    "https://proxy.example.test/backend-api",
    "http://chatgpt.com/backend-api",
    "https://user@chatgpt.com/backend-api",
    "https://chatgpt.com/backend-api?proxy=true",
    "https://chatgpt.com/other",
    "not a URL",
  ])("rejects %s", (baseUrl) => {
    expect(isOfficialCodexEndpoint(model(baseUrl))).toBe(false);
  });
});

describe("reloadCodexRequestOptions", () => {
  it("replaces the API key used by the official built-in transport", async () => {
    const options: SimpleStreamOptions = {
      apiKey: "old-token",
      headers: { "x-test": "value" },
      maxTokens: 4_096,
    };
    const result = await reloadCodexRequestOptions(model(), options, () =>
      Promise.resolve({
        status: "replace",
        credential: {
          accessToken: "new-token",
          accountId: "account-one",
          expiresAt: NOW + 60_000,
          revision: "revision",
        },
      }),
    );
    expect(result).toEqual({
      apiKey: "new-token",
      headers: { "x-test": "value" },
      maxTokens: 4_096,
    });
    expect(options.apiKey).toBe("old-token");
  });

  it.each([
    {
      status: "current",
      credential: {
        accessToken: "old-token",
        accountId: "account-one",
        expiresAt: NOW + 60_000,
        revision: "revision",
      },
    },
    { status: "unavailable", issue: "account-mismatch" },
  ] satisfies CredentialResolution[])(
    "preserves options for $status results",
    async (resolution) => {
      const options: SimpleStreamOptions = { apiKey: "old-token" };
      await expect(
        reloadCodexRequestOptions(model(), options, () => Promise.resolve(resolution)),
      ).resolves.toBe(options);
    },
  );

  it("does not read or expose the CLI credential for a custom endpoint", async () => {
    const resolveCredential = vi.fn(() =>
      Promise.resolve<CredentialResolution>({ status: "unavailable", issue: "missing" }),
    );
    const options: SimpleStreamOptions = { apiKey: "old-token" };
    await expect(
      reloadCodexRequestOptions(model("https://proxy.example.test"), options, resolveCredential),
    ).resolves.toBe(options);
    expect(resolveCredential).not.toHaveBeenCalled();
  });

  it("preserves absent request options", async () => {
    await expect(reloadCodexRequestOptions(model(), undefined)).resolves.toBeUndefined();
  });
});

describe("createCodexAuthReloadStream", () => {
  it("replaces auth before dispatch to the built-in transport", async () => {
    let observed: SimpleStreamOptions | undefined;
    const stream = createCodexAuthReloadStream(
      fakeStream((options) => {
        observed = options;
      }),
      () =>
        Promise.resolve({
          status: "replace",
          credential: {
            accessToken: "new-token",
            accountId: "account-one",
            expiresAt: NOW + 60_000,
            revision: "revision",
          },
        }),
    );
    await stream(model(), { messages: [] }, { apiKey: "old-token", maxTokens: 4_096 }).result();
    expect(observed).toMatchObject({ apiKey: "new-token", maxTokens: 4_096 });
  });

  it("lets two running stream wrappers observe the same replacement", async () => {
    const oldToken = jwt("account-one", "old");
    const newToken = jwt("account-one", "new");
    const path = await createAuthFile("account-one", oldToken);
    const resolve = (options: { apiKey?: string; headers: Record<string, string | null> }) =>
      resolveCodexCliCredential({ ...options, path, now: NOW });
    const observed: (string | undefined)[] = [];
    const create = () =>
      createCodexAuthReloadStream(
        fakeStream((options) => observed.push(options?.apiKey)),
        resolve,
      );
    const first = create();
    const second = create();

    await writeFile(
      path,
      JSON.stringify({ tokens: { access_token: newToken, account_id: "account-one" } }),
    );
    await first(model(), { messages: [] }, { apiKey: oldToken }).result();
    await second(model(), { messages: [] }, { apiKey: oldToken }).result();
    expect(observed).toEqual([newToken, newToken]);
  });

  it("fails closed for a non-Codex model", async () => {
    const transport = vi.fn(fakeStream(() => undefined));
    const stream = createCodexAuthReloadStream(transport);
    const incompatible = { ...model(), api: "openai-responses" as Api } as Model<Api>;
    const result = await stream(incompatible, { messages: [] }).result();
    expect(result.stopReason).toBe("error");
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("extension factory", () => {
  it("overlays only streamSimple so runtime catalog and auth behavior remain intact", () => {
    let registeredName: string | undefined;
    let registeredConfig: ProviderConfig | undefined;
    extension({
      registerProvider(name: string, config: ProviderConfig) {
        registeredName = name;
        registeredConfig = config;
      },
    } as never);
    expect(registeredName).toBe("openai-codex");
    expect(registeredConfig?.api).toBe("openai-codex-responses");
    expect(registeredConfig?.streamSimple).toBeTypeOf("function");
    expect(registeredConfig).not.toHaveProperty("models");
    expect(registeredConfig).not.toHaveProperty("oauth");
    expect(registeredConfig).not.toHaveProperty("baseUrl");
  });
});
