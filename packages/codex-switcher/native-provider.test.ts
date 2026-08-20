import { describe, expect, it } from "vitest";

import { loadOpenAICodexProvider } from "./native-provider.ts";

describe("loadOpenAICodexProvider", () => {
  it("loads the public built-in provider factory and model catalog", async () => {
    const provider = await loadOpenAICodexProvider();
    expect(provider.id).toBe("openai-codex");
    expect(provider.auth.oauth).toBeDefined();
    expect(provider.getModels()).not.toHaveLength(0);
  });
});
