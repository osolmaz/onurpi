import type { ResizedImage } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, type ImageBudgetConfig } from "./image-budget.ts";
import { applyResultPolicy, type ResizeImage, type ToolResultContent } from "./result-policy.ts";

type ResizeOptions = NonNullable<Parameters<ResizeImage>[2]>;

function config(overrides: Partial<ImageBudgetConfig> = {}): ImageBudgetConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

function image(bytes: number): ToolResultContent[number] {
  return { type: "image", data: "a".repeat(bytes), mimeType: "image/jpeg" };
}

function text(value: string): ToolResultContent[number] {
  return { type: "text", text: value };
}

function resized(data: string, wasResized = true): ResizedImage {
  return {
    data,
    mimeType: "image/jpeg",
    originalWidth: 4000,
    originalHeight: 3000,
    width: 1600,
    height: 1200,
    wasResized,
  };
}

function harness(
  impl: (inputBytes: number, options: ResizeOptions | undefined) => ResizedImage | null,
) {
  const calls: ResizeOptions[] = [];
  const resize: ResizeImage = (input, _mimeType, options) => {
    calls.push(options ?? {});
    return Promise.resolve(impl(input.byteLength, options));
  };
  return { calls, resize };
}

describe("applyResultPolicy", () => {
  it("passes through content without images", async () => {
    const { resize } = harness(() => null);
    const content: ToolResultContent = [text("done")];
    const policy = await applyResultPolicy(content, config(), resize);
    expect(policy.content).toBe(content);
    expect(policy.outcome).toEqual({ omitted: 0, resized: 0, dropped: 0, bytesSaved: 0 });
  });

  it("passes through images inside the per-image budget", async () => {
    const { calls, resize } = harness(() => null);
    const content: ToolResultContent = [text("shot"), image(1000)];
    const policy = await applyResultPolicy(content, config({ maxImageBytes: 4096 }), resize);
    expect(policy.content).toBe(content);
    expect(calls).toEqual([]);
  });

  it("does nothing when disabled", async () => {
    const { resize } = harness(() => null);
    const content: ToolResultContent = [image(5000)];
    const policy = await applyResultPolicy(content, config({ enabled: false }), resize);
    expect(policy.content).toBe(content);
  });

  it("re-encodes a large image with the configured limits", async () => {
    const { calls, resize } = harness(() => resized("b".repeat(1000)));
    const content: ToolResultContent = [text("shot"), image(5000)];
    const policy = await applyResultPolicy(
      content,
      config({ maxImageBytes: 2048, maxImageWidth: 800, maxImageHeight: 600 }),
      resize,
    );
    expect(calls).toEqual([{ maxWidth: 800, maxHeight: 600, maxBytes: 2048 }]);
    expect(policy.outcome).toEqual({ omitted: 0, resized: 1, dropped: 0, bytesSaved: 4000 });
    expect(policy.content).toHaveLength(2);
    const block = policy.content[1];
    expect(block).toEqual({ type: "image", data: "b".repeat(1000), mimeType: "image/jpeg" });
  });

  it("drops an image that cannot be re-encoded and explains why", async () => {
    const { resize } = harness(() => null);
    const content: ToolResultContent = [text("shot"), image(5000)];
    const policy = await applyResultPolicy(content, config({ maxImageBytes: 2048 }), resize);
    expect(policy.outcome).toEqual({ omitted: 0, resized: 0, dropped: 1, bytesSaved: 0 });
    expect(policy.content).toHaveLength(2);
    const note = policy.content[1];
    expect(note?.type).toBe("text");
    expect(note?.type === "text" ? note.text : "").toContain("could not be re-encoded");
  });

  it("keeps an image when re-encoding changes nothing", async () => {
    const data = "a".repeat(5000);
    const { resize } = harness(() => resized(data, false));
    const content: ToolResultContent = [{ type: "image", data, mimeType: "image/jpeg" }];
    const policy = await applyResultPolicy(content, config({ maxImageBytes: 2048 }), resize);
    expect(policy.content).toBe(content);
    expect(policy.outcome.resized).toBe(0);
  });

  it("keeps the first images and notes the rest", async () => {
    const { resize } = harness(() => null);
    const content: ToolResultContent = [image(10), image(20), image(30), text("tail")];
    const policy = await applyResultPolicy(content, config({ maxImagesPerResult: 2 }), resize);
    expect(policy.outcome.omitted).toBe(1);
    expect(policy.content).toEqual([
      image(10),
      image(20),
      text("tail"),
      expect.objectContaining({ type: "text" }),
    ]);
    const note = policy.content[3];
    expect(note?.type === "text" ? note.text : "").toContain("1 image omitted");
  });
});
