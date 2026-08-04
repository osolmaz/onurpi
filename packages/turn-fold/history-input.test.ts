import { describe, expect, it } from "vitest";

import { HistoryInput } from "./history-input.ts";

function type(input: HistoryInput, text: string): void {
  for (const character of text) input.handle(character);
}

describe("Turn Fold history input", () => {
  it("inserts text at the cursor and submits or cancels", () => {
    const input = new HistoryInput();
    type(input, "ac");
    input.handle("\u001b[D");
    input.handle("b");

    expect(input.text).toBe("abc");
    expect(input.handle("\r")).toBe("submit");
    expect(input.handle("\u001b")).toBe("cancel");
  });

  it("supports beginning, end, and character movement", () => {
    const input = new HistoryInput("abcd");

    input.handle("\u0001");
    input.handle("X");
    input.handle("\u0005");
    input.handle("Y");
    input.handle("\u0002");
    input.handle("\u0006");

    expect(input.text).toBe("XabcdY");
    expect(input.cursor).toBe(input.text.length);
  });

  it("keeps Unicode character movement intact", () => {
    const input = new HistoryInput("a😀b");

    input.handle("\u0002");
    input.handle("\u0002");
    input.handle("X");

    expect(input.text).toBe("aX😀b");
  });

  it("distinguishes whitespace and token word deletion", () => {
    const whitespace = new HistoryInput("one two-three");
    whitespace.handle("\u0017");
    expect(whitespace.text).toBe("one ");

    const token = new HistoryInput("one two-three");
    token.handle("\u001b\u007f");
    expect(token.text).toBe("one two-");
  });

  it("supports forward and backward word movement", () => {
    const input = new HistoryInput("one two");
    input.handle("\u001b[D");
    input.handle("\u001bb");
    expect(input.cursor).toBe(4);
    input.handle("\u001bf");
    expect(input.cursor).toBe(7);
  });

  it("pairs kill operations with yank", () => {
    const input = new HistoryInput("one two");
    input.handle("\u0015");
    expect(input.text).toBe("");
    input.handle("\u0019");
    expect(input.text).toBe("one two");

    input.handle("\u0001");
    input.handle("\u000b");
    input.handle("\u0019");
    expect(input.text).toBe("one two");
  });

  it("deletes forward with Delete or Ctrl+D", () => {
    const input = new HistoryInput("abc");
    input.handle("\u0001");
    input.handle("\u0004");
    input.handle("\u001b[3~");

    expect(input.text).toBe("c");
  });

  it("deletes the next token with Alt+D", () => {
    const input = new HistoryInput("one two");
    input.handle("\u0001");
    input.handle("\u001bd");

    expect(input.text).toBe(" two");
  });

  it("transposes characters and supports bounded undo", () => {
    const input = new HistoryInput("ab");
    input.handle("\u0014");
    expect(input.text).toBe("ba");
    input.handle("\u001f");
    expect(input.text).toBe("ab");
  });

  it("bounds input and ignores unbound control sequences", () => {
    const input = new HistoryInput("", 4);
    input.handle("abcdef");
    input.handle("\u0012");

    expect(input.text).toBe("abcd");
    expect(input.cursorText()).toBe("abcd▏");
  });
});
