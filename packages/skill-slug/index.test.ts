import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import skillSlug, { skillNamesFromSystemPrompt, skillSlugCommand } from "./index.ts";

const PROMPT_WITH_AMK = [
  "System prompt text.",
  "",
  "<available_skills>",
  "  <skill>",
  "    <name>amk</name>",
  "    <description>plain language</description>",
  "    <location>/skills/amk/SKILL.md</location>",
  "  </skill>",
  "</available_skills>",
].join("\n");

describe("skillSlugCommand", () => {
  const hasSlug = (slug: string) => slug === "amk";

  it("rewrites an exact slug to its skill command", () => {
    expect(skillSlugCommand("amk", hasSlug)).toBe("/skill:amk");
    expect(skillSlugCommand("  amk\n", hasSlug)).toBe("/skill:amk");
  });

  it("passes through anything else", () => {
    expect(skillSlugCommand("unknown", hasSlug)).toBeUndefined();
    expect(skillSlugCommand("amk please rewrite this", hasSlug)).toBeUndefined();
    expect(skillSlugCommand("AMK", hasSlug)).toBeUndefined();
    expect(skillSlugCommand("", hasSlug)).toBeUndefined();
    expect(skillSlugCommand("   ", hasSlug)).toBeUndefined();
    expect(skillSlugCommand("/skill:amk", hasSlug)).toBeUndefined();
  });
});

describe("skillNamesFromSystemPrompt", () => {
  it("extracts and unescapes skill names from the skills block", () => {
    const prompt = [
      "<available_skills>",
      "  <skill>",
      "    <name>amk</name>",
      "    <description>plain</description>",
      "  </skill>",
      "  <skill>",
      "    <name>a&amp;b</name>",
      "    <description>escaped</description>",
      "  </skill>",
      "</available_skills>",
    ].join("\n");
    expect(skillNamesFromSystemPrompt(prompt)).toEqual(["amk", "a&b"]);
  });

  it("returns an empty list without a block or without names", () => {
    expect(skillNamesFromSystemPrompt("no skills here")).toEqual([]);
    expect(skillNamesFromSystemPrompt("<available_skills></available_skills>")).toEqual([]);
  });
});

describe("skillSlug extension", () => {
  type Handler = (...args: never[]) => unknown;

  function createMockPi() {
    const handlers = new Map<string, Handler[]>();
    const pi = {
      on: vi.fn((event: string, handler: Handler) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      }),
    } as unknown as ExtensionAPI;
    return { pi, handlers };
  }

  function fakeCtx(systemPrompt = "") {
    return { getSystemPrompt: () => systemPrompt } as never;
  }

  function primeStructured(handlers: Map<string, Handler[]>, skills: unknown): void {
    for (const handler of handlers.get("before_agent_start") ?? []) {
      handler({ systemPromptOptions: skills } as never, fakeCtx());
    }
  }

  function input(handlers: Map<string, Handler[]>, event: unknown, systemPrompt = ""): unknown {
    return handlers.get("input")?.[0]?.(event as never, fakeCtx(systemPrompt));
  }

  it("transforms the first message of a session by priming from the system prompt", () => {
    const { pi, handlers } = createMockPi();
    skillSlug(pi);

    expect(input(handlers, { text: "amk", source: "interactive" }, PROMPT_WITH_AMK)).toEqual({
      action: "transform",
      text: "/skill:amk",
    });
    expect(input(handlers, { text: "hello", source: "interactive" })).toEqual({
      action: "continue",
    });
  });

  it("prefers the structured skills list and keeps it when a later list is empty", () => {
    const { pi, handlers } = createMockPi();
    skillSlug(pi);
    expect(input(handlers, { text: "amk", source: "interactive" }, "no skills here")).toEqual({
      action: "continue",
    });
    primeStructured(handlers, { skills: [{ name: "amk" }] });

    expect(input(handlers, { text: "amk", source: "interactive" })).toMatchObject({
      action: "transform",
    });

    primeStructured(handlers, { skills: [] });
    expect(input(handlers, { text: "amk", source: "interactive" })).toMatchObject({
      action: "transform",
    });

    primeStructured(handlers, {});
    expect(input(handlers, { text: "amk", source: "interactive" })).toMatchObject({
      action: "transform",
    });
  });

  it("keeps attached images on the transformed input", () => {
    const { pi, handlers } = createMockPi();
    skillSlug(pi);
    const images = [{ type: "image", data: "...", mimeType: "image/png" }];
    expect(
      input(handlers, { text: "amk", source: "interactive", images }, PROMPT_WITH_AMK),
    ).toEqual({
      action: "transform",
      text: "/skill:amk",
      images,
    });
  });

  it("keeps structured skills captured by an extension-triggered first run", () => {
    const { pi, handlers } = createMockPi();
    skillSlug(pi);

    expect(input(handlers, { text: "amk", source: "extension" }, PROMPT_WITH_AMK)).toEqual({
      action: "continue",
    });
    primeStructured(handlers, { skills: [{ name: "hidden-skill" }] });

    expect(input(handlers, { text: "hidden-skill", source: "interactive" }, PROMPT_WITH_AMK))
      .toEqual({
        action: "transform",
        text: "/skill:hidden-skill",
      });
    expect(input(handlers, { text: "amk", source: "interactive" })).toEqual({
      action: "continue",
    });
  });

  it("passes through extension-sourced input that Pi would not expand", () => {
    const { pi, handlers } = createMockPi();
    skillSlug(pi);

    expect(input(handlers, { text: "amk", source: "extension" }, PROMPT_WITH_AMK)).toEqual({
      action: "continue",
    });
    expect(input(handlers, { text: "amk", source: "rpc" }, PROMPT_WITH_AMK)).toMatchObject({
      action: "transform",
    });
  });
});
