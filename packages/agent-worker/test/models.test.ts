import { describe, expect, it } from "vitest";
import { MODEL_PROVIDERS } from "../src/config.ts";
import { echoProvider, workerModels } from "../src/models.ts";

describe("echoProvider", () => {
  it("always has an answer ready", () => {
    expect(echoProvider().getPendingResponseCount()).toBe(1);
  });
});

describe("workerModels", () => {
  it.each(MODEL_PROVIDERS)("sets up the %s provider without a network call", (provider) => {
    expect(() => workerModels(provider)).not.toThrow();
  });
});
