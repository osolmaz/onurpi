import { describe, expect, it } from "vitest";

import { applyContextPolicy, type ContextMessages, type ContextMessage } from "./context-policy.ts";
import { DEFAULT_CONFIG, REDACTED_MARKER, type ImageBudgetConfig } from "./image-budget.ts";
import type { ToolResultContent } from "./result-policy.ts";

function config(overrides: Partial<ImageBudgetConfig> = {}): ImageBudgetConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

function image(bytes: number): ToolResultContent[number] {
  return { type: "image", data: "a".repeat(bytes), mimeType: "image/jpeg" };
}

function text(value: string): ToolResultContent[number] {
  return { type: "text", text: value };
}

function toolResult(content: ToolResultContent): ContextMessage {
  return {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "unified-exec",
    content,
    isError: false,
    timestamp: 1,
  };
}

function user(content: ToolResultContent): ContextMessage {
  return { role: "user", content, timestamp: 2 };
}

function blockText(block: ToolResultContent[number] | undefined): string {
  return block?.type === "text" ? block.text : "";
}

describe("applyContextPolicy", () => {
  it("reports an image-free context", () => {
    const messages: ContextMessages = [user([text("hello")])];
    const outcome = applyContextPolicy(messages, config());
    expect(outcome).toEqual({ imageCount: 0, bytesBefore: 0, bytesAfter: 0, redactCount: 0 });
  });

  it("keeps images while they fit the budget", () => {
    const content: ToolResultContent = [text("shot"), image(100)];
    const messages: ContextMessages = [toolResult(content)];
    const outcome = applyContextPolicy(messages, config({ imageBudgetBytes: 1000 }));
    expect(outcome.redactCount).toBe(0);
    expect(outcome.imageCount).toBe(1);
    expect(outcome.bytesBefore).toBe(100);
    expect(content[1]).toEqual(image(100));
  });

  it("redacts the oldest images and explains the loss once", () => {
    const old: ToolResultContent = [image(40), text("first")];
    const middle: ToolResultContent = [image(40)];
    const newest: ToolResultContent = [image(40)];
    const messages: ContextMessages = [toolResult(old), user(middle), toolResult(newest)];
    const outcome = applyContextPolicy(
      messages,
      config({ imageBudgetBytes: 100, redactToBytes: 50 }),
    );
    expect(outcome.redactCount).toBe(2);
    expect(outcome.bytesBefore).toBe(120);
    expect(outcome.bytesAfter).toBe(40);
    expect(blockText(old[0])).toContain("2 images redacted by image-budget");
    expect(blockText(old[0])).toContain("unified-exec");
    expect(blockText(middle[0])).toBe(REDACTED_MARKER);
    expect(newest[0]).toEqual(image(40));
  });

  it("summarizes redacted images from user messages with an unknown tool", () => {
    const first = [image(200)];
    const messages: ContextMessages = [user(first), toolResult([image(200)])];
    applyContextPolicy(messages, config({ imageBudgetBytes: 300, redactToBytes: 100 }));
    expect(blockText(first[0])).toContain("unknown tool");
  });

  it("keeps the newest image when it alone fits the budget", () => {
    const oldest = [image(200)];
    const newest = [image(200)];
    const messages: ContextMessages = [toolResult(oldest), toolResult(newest)];
    const outcome = applyContextPolicy(
      messages,
      config({ imageBudgetBytes: 300, redactToBytes: 100 }),
    );
    expect(outcome.redactCount).toBe(1);
    expect(outcome.bytesAfter).toBe(200);
    expect(newest[0]).toEqual(image(200));
  });

  it("does nothing when disabled", () => {
    const content = [image(5000)];
    const messages: ContextMessages = [toolResult(content)];
    const outcome = applyContextPolicy(messages, config({ enabled: false, imageBudgetBytes: 10 }));
    expect(outcome.redactCount).toBe(0);
    expect(content[0]).toEqual(image(5000));
  });
});
