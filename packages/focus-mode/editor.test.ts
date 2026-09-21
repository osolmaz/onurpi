import { describe, expect, it } from "vitest";

import { preserveRejectedPrompt } from "./editor.ts";

function surface(initial = ""): {
  ui: { getEditorText(): string; setEditorText(text: string): void };
  read(): string;
  writes(): number;
} {
  let text = initial;
  let writes = 0;
  return {
    ui: {
      getEditorText: () => text,
      setEditorText: (next: string) => {
        text = next;
        writes += 1;
      },
    },
    read: () => text,
    writes: () => writes,
  };
}

describe("preserveRejectedPrompt", () => {
  it("restores the text when Pi cleared the editor", () => {
    const editor = surface("");
    const result = preserveRejectedPrompt(editor.ui, "keep me");
    expect(result).toEqual({ restored: true, images: 0 });
    expect(editor.read()).toBe("keep me");
    expect(editor.writes()).toBe(1);
  });

  it("does not write when the editor already holds the text", () => {
    const editor = surface("keep me");
    expect(preserveRejectedPrompt(editor.ui, "keep me")).toEqual({ restored: true, images: 0 });
    expect(editor.writes()).toBe(0);
  });

  it("never overwrites text the user already started writing", () => {
    const editor = surface("a new idea");
    expect(preserveRejectedPrompt(editor.ui, "keep me")).toEqual({ restored: false, images: 0 });
    expect(editor.read()).toBe("a new idea");
  });

  it("has nothing to restore for an empty prompt", () => {
    const editor = surface("kept");
    expect(preserveRejectedPrompt(editor.ui, "")).toEqual({ restored: false, images: 0 });
    expect(editor.read()).toBe("kept");
  });

  it("counts the images the editor could not keep", () => {
    const editor = surface("");
    const result = preserveRejectedPrompt(editor.ui, "look", [{}, {}]);
    expect(result).toEqual({ restored: true, images: 2 });
  });
});
