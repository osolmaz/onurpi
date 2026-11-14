import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_LABEL,
  fitHeader,
  HEADER_SOURCE_LIMIT,
  headerBody,
  headerSource,
  PROMPT_MARK,
  styledHeader,
} from "./header.ts";

function userMessage(content: unknown): { content: unknown; role: "user" } {
  return { content, role: "user" };
}

function stubTheme(): Theme {
  return {
    bg: (color: string, text: string) => `<bg:${color}>${text}</bg>`,
    fg: (color: string, text: string) => `<fg:${color}>${text}</fg>`,
  } as unknown as Theme;
}

describe("headerSource", () => {
  it("collapses whitespace and newlines into one line", () => {
    const message = userMessage([{ type: "text", text: "  fix the\n\nparser  " }]);

    expect(headerSource(message)).toBe("fix the parser");
  });

  it("joins several text parts", () => {
    const message = userMessage([
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ]);

    expect(headerSource(message)).toBe("first second");
  });

  it("labels an attachment-only message", () => {
    expect(headerSource(userMessage([{ type: "image", data: "x" }]))).toBe(ATTACHMENT_LABEL);
  });

  it("returns undefined for an empty or unknown message", () => {
    expect(headerSource(userMessage([]))).toBeUndefined();
    expect(headerSource(userMessage([{ type: "text", text: "   " }]))).toBeUndefined();
    expect(headerSource(undefined)).toBeUndefined();
    expect(headerSource({ content: "plain string" })).toBeUndefined();
  });

  it("caps very long prompts", () => {
    const message = userMessage([{ type: "text", text: "a".repeat(HEADER_SOURCE_LIMIT + 50) }]);

    expect(headerSource(message)).toHaveLength(HEADER_SOURCE_LIMIT);
  });
});

describe("header row", () => {
  it("marks the prompt and fills the width", () => {
    const line = fitHeader(headerBody("explain the parser"), 30);

    const body = headerBody("explain the parser");
    expect(line).toBe(`${body}${" ".repeat(30 - visibleWidth(body))}`);
    expect(line).toHaveLength(30);
  });

  it("truncates to the width without overflowing", () => {
    const line = fitHeader(headerBody("b".repeat(200)), 20);

    expect(line).toBeDefined();
    expect(visibleWidth(line ?? "")).toBe(20);
  });

  it("returns undefined when there is no room", () => {
    expect(fitHeader(headerBody("hello"), 0)).toBeUndefined();
    expect(fitHeader("", 10)).toBeUndefined();
  });

  it("paints the prompt row with the user message colors", () => {
    const line = styledHeader("check the log", 20, stubTheme());

    expect(line).toContain("<bg:userMessageBg>");
    expect(line).toContain("<fg:userMessageText>");
    expect(line).toContain(`${PROMPT_MARK} check the log`);
  });

  it("renders unstyled when no theme has been seen yet", () => {
    expect(styledHeader("check the log", 20, undefined)).toBe(fitHeader("› check the log", 20));
  });
});
