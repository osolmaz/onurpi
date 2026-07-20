import { describe, expect, it } from "vitest";

import { PromptHistory } from "./history-model.ts";

describe("PromptHistory", () => {
  it("stores trimmed entries newest first", () => {
    const history = new PromptHistory();
    history.add("first");
    history.add("  second  ");
    expect(history.entries()).toEqual(["second", "first"]);
    expect(history.size).toBe(2);
  });

  it("ignores blank entries", () => {
    const history = new PromptHistory();
    history.add("   ");
    history.add("");
    expect(history.entries()).toEqual([]);
  });

  it("skips consecutive duplicates but keeps non-consecutive ones", () => {
    const history = new PromptHistory();
    history.add("a");
    history.add("a ");
    history.add("b");
    history.add("a");
    expect(history.entries()).toEqual(["a", "b", "a"]);
  });

  it("caps stored entries at the limit, dropping the oldest", () => {
    const history = new PromptHistory(2);
    history.add("one");
    history.add("two");
    history.add("three");
    expect(history.entries()).toEqual(["three", "two"]);
  });

  it("updates entries in place with trimming", () => {
    const history = new PromptHistory();
    history.add("old");
    expect(history.updateAt(0, "  new  ")).toBe(true);
    expect(history.entries()).toEqual(["new"]);
  });

  it("rejects updates that are blank or out of range", () => {
    const history = new PromptHistory();
    history.add("keep");
    expect(history.updateAt(0, "   ")).toBe(false);
    expect(history.updateAt(-1, "x")).toBe(false);
    expect(history.updateAt(1, "x")).toBe(false);
    expect(history.entries()).toEqual(["keep"]);
  });

  it("removes entries by index", () => {
    const history = new PromptHistory();
    history.add("a");
    history.add("b");
    expect(history.removeAt(1)).toBe(true);
    expect(history.entries()).toEqual(["b"]);
    expect(history.removeAt(1)).toBe(false);
    expect(history.removeAt(-1)).toBe(false);
  });

  it("resets to empty", () => {
    const history = new PromptHistory();
    history.add("a");
    history.reset();
    expect(history.entries()).toEqual([]);
    expect(history.size).toBe(0);
  });
});
