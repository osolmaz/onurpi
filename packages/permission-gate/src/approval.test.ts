import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import {
  createApprovalComponent,
  decideFromKey,
  DIALOG_HINT,
  DIALOG_TITLE,
  TYPED_AHEAD_GUARD_MS,
} from "./approval.ts";

describe("decideFromKey", () => {
  it("allows on y after the guard", () => {
    expect(decideFromKey("y", TYPED_AHEAD_GUARD_MS)).toBe("allow");
    expect(decideFromKey("Y", TYPED_AHEAD_GUARD_MS + 1)).toBe("allow");
  });

  it("ignores an allow key that arrives inside the guard", () => {
    expect(decideFromKey("y", TYPED_AHEAD_GUARD_MS - 1)).toBe("ignore");
  });

  it("denies on n at any time, because a deny is always safe", () => {
    expect(decideFromKey("n", 0)).toBe("deny");
    expect(decideFromKey("N", 10)).toBe("deny");
  });

  it("ignores every other key", () => {
    for (const data of ["", "\r", "\n", " ", "j", "k", "a"]) {
      expect(decideFromKey(data, 10_000)).toBe("ignore");
    }
  });
});

type Harness = {
  component: Component;
  done: ReturnType<typeof vi.fn>;
};

function createHarness(summary = "bash: npm test", now = 10_000): Harness {
  const done = vi.fn();
  const component = createApprovalComponent({
    summary,
    text: { title: (text) => text, body: (text) => text, hint: (text) => text },
    matchesCancel: (data) => data === "\u001b",
    now: () => now,
    openedAt: 0,
    done,
  });
  return { component, done };
}

function render(component: Component, width = 40): string[] {
  return component.render(width);
}

function press(component: Component, data: string): void {
  component.handleInput?.(data);
}

describe("createApprovalComponent", () => {
  it("shows the title, the whole call, and the key hint", () => {
    const { component } = createHarness();
    expect(render(component)).toEqual([DIALOG_TITLE, "bash: npm test", DIALOG_HINT]);
  });

  it("wraps a long call instead of cutting it", () => {
    const summary = "bash: " + "word ".repeat(12).trim();
    const { component } = createHarness(summary);
    const lines = render(component, 20);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every((line) => visibleWidth(line) <= 20)).toBe(true);
    expect(lines.join(" ").split(/\s+/u)).toContain("word");
  });

  it("reuses the rendered lines for the same width", () => {
    const { component } = createHarness();
    const first = render(component);
    expect(render(component)).toBe(first);
  });

  it("allows on y and denies on n", () => {
    const allow = createHarness();
    press(allow.component, "y");
    expect(allow.done).toHaveBeenCalledWith(true);

    const deny = createHarness();
    press(deny.component, "n");
    expect(deny.done).toHaveBeenCalledWith(false);
  });

  it("denies on cancel and ignores other keys", () => {
    const harness = createHarness();
    press(harness.component, "j");
    press(harness.component, "\r");
    expect(harness.done).not.toHaveBeenCalled();
    press(harness.component, "\u001b");
    expect(harness.done).toHaveBeenCalledWith(false);
  });

  it("ignores the allow key while the typed-ahead guard runs", () => {
    const harness = createHarness("bash: npm test", 0);
    press(harness.component, "y");
    expect(harness.done).not.toHaveBeenCalled();
  });
});
