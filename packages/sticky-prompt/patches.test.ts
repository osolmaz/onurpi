import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { Container, ScrollView, Text, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";

import { PROMPT_MARK } from "./header.ts";
import { installPromptHeaderPatches, type RestorePromptHeaderPatches } from "./patches.ts";
import { promptSpans } from "./prompt-rows.ts";

const LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node");
const WIDTH = 40;

initTheme("dark", false);

function lines(count: number, label = "content"): Text {
  return new Text(
    Array.from({ length: count }, (_value, index) => `${label} ${String(index)}`).join("\n"),
    0,
    0,
  );
}

function viewport(): { content: Container; scroll: ScrollView } {
  const content = new Container();
  content.addChild(lines(2));
  content.addChild(new UserMessageComponent("first prompt", undefined, 0));
  content.addChild(lines(8));
  content.addChild(new UserMessageComponent("second prompt", undefined, 0));
  content.addChild(lines(4));
  const scroll = new ScrollView(content, { follow: "end", primary: true });
  return { content, scroll };
}

function setScrollTop(scroll: ScrollView, scrollTop: number): void {
  Reflect.set(scroll, "currentScrollTop", scrollTop);
}

function register(scroll: ScrollView): void {
  const node: unknown = Reflect.get(scroll, LAYOUT_NODE);
  if (typeof node === "function") (node as (this: ScrollView) => unknown).call(scroll);
}

/** First scroll position at which the prompt is fully above the viewport. */
function firstScrollPastPrompt(content: Container, scroll: ScrollView, index: number): number {
  content.render(scroll.getContentWidth(WIDTH));
  const span = promptSpans(content, scroll.getContentWidth(WIDTH))[index];
  if (span === undefined) throw new Error("prompt span is missing");
  return span.end;
}

let restore: RestorePromptHeaderPatches | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
});

describe("prompt header patches", () => {
  it("leaves the transcript alone while the prompt row is on screen", () => {
    const { content, scroll } = viewport();
    restore = installPromptHeaderPatches(() => undefined);
    register(scroll);

    const rendered = content.render(WIDTH);

    expect(rendered[0]?.startsWith("content 0")).toBe(true);
    expect(rendered.join("\n")).not.toContain(PROMPT_MARK);
  });

  it("replaces the first visible line with the prompt of the turn above it", () => {
    const { content, scroll } = viewport();
    restore = installPromptHeaderPatches(() => undefined);
    register(scroll);
    const scrollTop = firstScrollPastPrompt(content, scroll, 0);
    const before = content.render(WIDTH);
    setScrollTop(scroll, scrollTop);

    const rendered = content.render(WIDTH);

    expect(rendered).toHaveLength(before.length);
    expect(rendered[scrollTop]).toContain(`${PROMPT_MARK} first prompt`);
    expect(visibleWidth(rendered[scrollTop] ?? "")).toBe(WIDTH);
    expect(rendered[scrollTop - 1]).toBe(before[scrollTop - 1]);
    expect(rendered[scrollTop + 1]).toBe(before[scrollTop + 1]);
  });

  it("follows the newest prompt once it scrolls off", () => {
    const { content, scroll } = viewport();
    restore = installPromptHeaderPatches(() => undefined);
    register(scroll);
    const scrollTop = firstScrollPastPrompt(content, scroll, 1);
    setScrollTop(scroll, scrollTop);

    const rendered = content.render(WIDTH);

    expect(rendered[scrollTop]).toContain(`${PROMPT_MARK} second prompt`);
  });

  it("shows no header above a prompt that is still on screen", () => {
    const { content, scroll } = viewport();
    restore = installPromptHeaderPatches(() => undefined);
    register(scroll);
    content.render(scroll.getContentWidth(WIDTH));
    const secondPrompt = promptSpans(content, scroll.getContentWidth(WIDTH))[1];
    if (secondPrompt === undefined) throw new Error("prompt span is missing");

    for (let scrollTop = secondPrompt.start; scrollTop < secondPrompt.end; scrollTop += 1) {
      setScrollTop(scroll, scrollTop);
      const patched = content.render(WIDTH);
      restore();
      restore = undefined;
      const plain = content.render(WIDTH);
      expect(patched).toEqual(plain);
      restore = installPromptHeaderPatches(() => undefined);
    }
  });

  it("ignores a scroll view whose content was never laid out", () => {
    const content = new Container();
    content.addChild(new UserMessageComponent("unlaid prompt", undefined, 0));
    content.addChild(lines(3));
    restore = installPromptHeaderPatches(() => undefined);

    expect(content.render(WIDTH).join("\n")).not.toContain(PROMPT_MARK);
  });

  it("restores both prototypes exactly", () => {
    const containerRender: unknown = Container.prototype.render;
    const scrollNode: unknown = Reflect.get(ScrollView.prototype, LAYOUT_NODE);

    restore = installPromptHeaderPatches(() => undefined);
    expect(Container.prototype.render).not.toBe(containerRender);
    expect(Reflect.get(ScrollView.prototype, LAYOUT_NODE)).not.toBe(scrollNode);

    restore();
    restore = undefined;

    expect(Container.prototype.render).toBe(containerRender);
    expect(Reflect.get(ScrollView.prototype, LAYOUT_NODE)).toBe(scrollNode);
  });

  it("serves every transcript in the session", () => {
    const first = viewport();
    const second = viewport();
    restore = installPromptHeaderPatches(() => undefined);
    register(first.scroll);
    register(second.scroll);
    const scrollTop = firstScrollPastPrompt(second.content, second.scroll, 0);
    setScrollTop(second.scroll, scrollTop);

    expect(first.content.render(WIDTH).join("\n")).not.toContain(PROMPT_MARK);
    expect(second.content.render(WIDTH)[scrollTop]).toContain(`${PROMPT_MARK} first prompt`);
  });
});
