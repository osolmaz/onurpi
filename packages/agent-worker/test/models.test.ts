import { describe, expect, it } from "vitest";
import { MODEL_PROVIDERS } from "../src/config.ts";
import { echoProvider, workerModels } from "../src/models.ts";
import { codexTokenAlias, openshellCodexCredentials } from "../src/openshell.ts";

describe("echoProvider", () => {
  it("always has an answer ready", () => {
    expect(echoProvider().getPendingResponseCount()).toBe(1);
  });
});

const placeholders = {
  CODEX_AUTH_ACCESS_TOKEN: "openshell:resolve:env:s1:CODEX_AUTH_ACCESS_TOKEN",
  CODEX_AUTH_ACCOUNT_ID: "openshell:resolve:env:s2:CODEX_AUTH_ACCOUNT_ID",
};

describe("workerModels", () => {
  it.each(MODEL_PROVIDERS)("sets up the %s provider without a network call", (provider) => {
    const models = workerModels({ modelId: "test-model", provider }, placeholders);
    expect(models.getProvider(provider)?.id).toBe(provider);
  });
});

describe("the openshell Codex login", () => {
  it("wraps the access token placeholder in the JWT shape OpenShell resolves", () => {
    const alias = codexTokenAlias(
      placeholders.CODEX_AUTH_ACCESS_TOKEN,
      placeholders.CODEX_AUTH_ACCOUNT_ID,
    );
    const [header = "", claims = "", signature] = alias.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "none",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      "https://api.openai.com/auth": { chatgpt_account_id: placeholders.CODEX_AUTH_ACCOUNT_ID },
    });
    expect(signature).toBe("OPENSHELL-RESOLVE-ENV-s1:CODEX_AUTH_ACCESS_TOKEN");
  });

  it("refuses a value that is not a placeholder", () => {
    expect(() => codexTokenAlias("real-token", "account")).toThrow("not an OpenShell placeholder");
  });

  it("needs the attached provider", () => {
    expect(() => openshellCodexCredentials({})).toThrow("Attach the Codex provider");
  });

  it("gives Pi AI the wrapped token as the API key, without a refresh", async () => {
    const models = workerModels({ modelId: "gpt-6.1-sol", provider: "openai-codex" }, placeholders);
    const auth = await models.getAuth("openai-codex");
    expect(auth?.auth.apiKey).toBe(
      codexTokenAlias(placeholders.CODEX_AUTH_ACCESS_TOKEN, placeholders.CODEX_AUTH_ACCOUNT_ID),
    );
    const store = openshellCodexCredentials(placeholders);
    expect(await store.list()).toEqual([{ providerId: "openai-codex", type: "oauth" }]);
    expect(await store.read("anthropic")).toBeUndefined();
    await store.delete("openai-codex");
    expect((await store.modify("openai-codex", () => Promise.resolve(undefined)))?.type).toBe(
      "oauth",
    );
  });
});
