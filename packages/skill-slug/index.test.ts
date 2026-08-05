import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import skillSlug, { skillSlugCommand } from "./index.ts";

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

  function primeSkills(handlers: Map<string, Handler[]>, skills: unknown): void {
    for (const handler of handlers.get("before_agent_start") ?? []) {
      handler({ systemPromptOptions: skills } as never);
    }
  }

  function input(handlers: Map<string, Handler[]>, event: unknown): unknown {
    return handlers.get("input")?.[0]?.(event as never);
  }

  it("transforms a bare slug once skills are known", () => {
    const { pi, handlers } = createMockPi();
    skillSlug(pi);

    primeSkills(handlers, {
      skills: [
        {
          name: "amk",
          description: "plain language",
          filePath: "/skills/amk/SKILL.md",
          baseDir: "/skills/amk",
          sourceInfo: { source: "user", path: "/skills/amk", scope: "user" },
          disableModelInvocation: false,
        },
      ],
    });

    expect(input(handlers, { text: "amk", source: "interactive" })).toEqual({
      action: "transform",
      text: "/skill:amk",
      images: undefined,
    });
    expect(input(handlers, { text: "hello", source: "interactive" })).toEqual({
      action: "continue",
    });
  });

  it("keeps attached images on the transformed input", () => {
    const { pi, handlers } = createMockPi();
    skillSlug(pi);
    primeSkills(handlers, { skills: [{ name: "amk" }] });
    const images = [{ type: "image", data: "...", mimeType: "image/png" }];
    expect(input(handlers, { text: "amk", source: "interactive", images })).toEqual({
      action: "transform",
      text: "/skill:amk",
      images,
    });
  });

  it("passes through extension-sourced input that Pi would not expand", () => {
    const { pi, handlers } = createMockPi();
    skillSlug(pi);
    primeSkills(handlers, { skills: [{ name: "amk" }] });

    expect(input(handlers, { text: "amk", source: "extension" })).toEqual({
      action: "continue",
    });
    expect(input(handlers, { text: "amk", source: "rpc" })).toMatchObject({
      action: "transform",
    });
  });

  it("cannot match before the first agent run and refreshes on later runs", () => {
    const { pi, handlers } = createMockPi();
    skillSlug(pi);

    expect(input(handlers, { text: "amk", source: "interactive" })).toEqual({
      action: "continue",
    });

    primeSkills(handlers, { skills: [{ name: "amk" }] });
    expect(input(handlers, { text: "amk", source: "interactive" })).toMatchObject({
      action: "transform",
    });

    primeSkills(handlers, {});
    expect(input(handlers, { text: "amk", source: "interactive" })).toEqual({
      action: "continue",
    });
  });
});
