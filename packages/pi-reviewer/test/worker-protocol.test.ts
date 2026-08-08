import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { readWorkerRequest, validateWorkerRequest } from "../src/worker-protocol.js";

const REQUEST = {
  version: 1,
  cwd: "/repo",
  prompt: "Review",
  authPath: "/pi/auth.json",
  modelsPath: "/reviewer/models.json",
  configDir: "/reviewer",
  extensionPath: "/reviewer/review-guard.ts",
  systemPrompt: "Review code",
  provider: "openai-codex",
  model: "review-model",
  customModel: false,
  thinking: "high",
  tools: ["read", "review_shell"],
} as const;

describe("review worker protocol", () => {
  it("validates the bounded versioned request", async () => {
    expect(validateWorkerRequest(REQUEST)).toEqual(REQUEST);
    const input = Readable.from([JSON.stringify(REQUEST)]);
    await expect(readWorkerRequest(input)).resolves.toEqual(REQUEST);
  });

  it("rejects unknown fields and invalid values", () => {
    expect(() => validateWorkerRequest({ ...REQUEST, secret: "credential" })).toThrow(
      "unknown field",
    );
    expect(() => validateWorkerRequest({ ...REQUEST, thinking: "extreme" })).toThrow(
      "thinking level",
    );
    expect(() => validateWorkerRequest({ ...REQUEST, tools: [""] })).toThrow("nonempty strings");
    expect(() => validateWorkerRequest({ ...REQUEST, customModel: "yes" })).toThrow(
      "customModel is required",
    );
  });

  it("bounds worker input before parsing", async () => {
    const input = Readable.from([Buffer.alloc(2 * 1024 * 1024 + 1, 0x20)]);
    await expect(readWorkerRequest(input)).rejects.toThrow("size limit");
  });
});
