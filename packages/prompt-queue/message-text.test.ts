import { describe, expect, it } from "vitest";

import { assistantStopReason, userMessageText } from "./message-text.ts";

describe("assistantStopReason", () => {
  it("returns the stop reason of an assistant message", () => {
    expect(assistantStopReason({ role: "assistant", stopReason: "aborted" })).toBe("aborted");
    expect(assistantStopReason({ role: "assistant", stopReason: "stop" })).toBe("stop");
  });

  it("returns undefined for non-assistant messages and malformed values", () => {
    expect(assistantStopReason({ role: "user", stopReason: "stop" })).toBeUndefined();
    expect(assistantStopReason({ role: "assistant" })).toBeUndefined();
    expect(assistantStopReason({ role: "assistant", stopReason: 3 })).toBeUndefined();
    expect(assistantStopReason(undefined)).toBeUndefined();
    expect(assistantStopReason("text")).toBeUndefined();
    expect(assistantStopReason(null)).toBeUndefined();
  });
});

describe("userMessageText", () => {
  it("returns string content directly", () => {
    expect(userMessageText({ role: "user", content: "hello" })).toBe("hello");
  });

  it("joins text parts from structured content", () => {
    const message = {
      role: "user",
      content: [
        { type: "text", text: "first" },
        { type: "image", text: "IGNORED" },
        { type: "text", text: "second" },
        { type: "text", text: 5 },
        "garbage",
      ],
    };
    expect(userMessageText(message)).toBe("first\nsecond");
  });

  it("returns undefined for non-user messages and malformed content", () => {
    expect(userMessageText({ role: "assistant", content: "x" })).toBeUndefined();
    expect(userMessageText({ role: "user", content: 5 })).toBeUndefined();
    expect(userMessageText(null)).toBeUndefined();
  });
});
