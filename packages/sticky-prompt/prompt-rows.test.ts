import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { type Component, Container, Text } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { childSpans, promptAt, promptSpans, type PromptSpan } from "./prompt-rows.ts";

const WIDTH = 40;

initTheme("dark", false);

function lines(count: number, label = "line"): Text {
  return new Text(
    Array.from({ length: count }, (_value, index) => `${label} ${String(index)}`).join("\n"),
    0,
    0,
  );
}

function prompt(text: string): UserMessageComponent {
  return new UserMessageComponent(text, undefined, 0);
}

function starts(children: readonly Component[]): number[] {
  const result: number[] = [];
  let start = 0;
  for (const child of children) {
    result.push(start);
    start += child.render(WIDTH).length;
  }
  return result;
}

describe("childSpans", () => {
  it("counts each child from the container's first line", () => {
    const children: Component[] = [lines(2), prompt("first prompt"), lines(5)];
    const container = new Container();
    for (const child of children) container.addChild(child);
    container.render(WIDTH);

    const spans = childSpans(container, WIDTH);
    const expected = starts(children);

    expect(spans?.map((span) => span.start)).toEqual(expected);
    expect(spans?.at(-1)?.end).toBe(container.render(WIDTH).length);
  });

  it("returns undefined before the first render at this width", () => {
    expect(childSpans(new Container(), WIDTH)).toBeUndefined();
    expect(childSpans(transcript(), WIDTH)).toBeUndefined();
  });

  it("returns undefined after a width change", () => {
    const container = transcript();
    container.render(WIDTH);

    expect(childSpans(container, WIDTH + 1)).toBeUndefined();
  });
});

function transcript(): Container {
  const container = new Container();
  container.addChild(lines(2));
  container.addChild(prompt("first prompt"));
  container.addChild(lines(5));
  container.addChild(prompt("second prompt"));
  container.addChild(lines(3));
  return container;
}

describe("promptSpans", () => {
  it("finds every user prompt in transcript order", () => {
    const container = transcript();
    container.render(WIDTH);

    const found = promptSpans(container, WIDTH);
    const rendered = container.render(WIDTH);

    expect(found).toHaveLength(2);
    expect(found[0]?.start).toBe(2);
    expect(found[0]?.end).toBe(2 + prompt("first prompt").render(WIDTH).length);
    expect(found[1]?.end).toBeLessThanOrEqual(rendered.length);
    expect(found[1]?.start).toBeGreaterThan(found[0]?.start ?? 0);
  });

  it("finds prompts nested in a child container", () => {
    const outer = new Container();
    const inner = new Container();
    inner.addChild(lines(3));
    inner.addChild(prompt("nested prompt"));
    const spacer = lines(1);
    outer.addChild(spacer);
    outer.addChild(inner);
    outer.render(WIDTH);

    const innerStart = starts([spacer, inner])[1] ?? 0;

    expect(promptSpans(outer, WIDTH).map((span) => span.start)).toEqual([
      innerStart + lines(3).render(WIDTH).length,
    ]);
  });

  it("returns nothing for a transcript without prompts", () => {
    const container = new Container();
    container.addChild(lines(2));
    container.render(WIDTH);

    expect(promptSpans(container, WIDTH)).toEqual([]);
  });
});

describe("promptAt", () => {
  const spans: PromptSpan[] = [
    { component: {}, end: 4, start: 2 },
    { component: {}, end: 11, start: 9 },
  ];

  it.each([
    [0, undefined],
    [1, undefined],
    [2, undefined],
    [3, undefined],
    [4, 2],
    [8, 2],
    [9, undefined],
    [10, undefined],
    [11, 9],
    [500, 9],
  ])("picks the prompt above line %i", (scrollTop, expectedStart) => {
    expect(promptAt(spans, scrollTop)?.start).toBe(expectedStart);
  });

  it("hides the header while any part of the prompt is still on screen", () => {
    const prompt: PromptSpan[] = [{ component: {}, end: 4, start: 2 }];

    expect(promptAt(prompt, 2)).toBeUndefined();
    expect(promptAt(prompt, 3)).toBeUndefined();
    expect(promptAt(prompt, 4)?.start).toBe(2);
  });

  it("ignores a non-finite scroll offset", () => {
    expect(promptAt(spans, Number.NaN)).toBeUndefined();
  });

  it("returns undefined when no prompt has scrolled off", () => {
    expect(promptAt([], 5)).toBeUndefined();
  });
});
