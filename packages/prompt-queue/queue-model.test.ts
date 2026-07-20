import { describe, expect, it } from "vitest";

import { PromptQueue } from "./queue-model.ts";

describe("PromptQueue", () => {
  it("adds items in order with unique incrementing ids", () => {
    const queue = new PromptQueue();
    const first = queue.add("one", "queue");
    const second = queue.add("two", "steer");
    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
    expect(queue.size).toBe(2);
    expect(queue.items().map((item) => item.text)).toEqual(["one", "two"]);
    expect(queue.items().map((item) => item.mode)).toEqual(["queue", "steer"]);
  });

  it("keeps ids unique after removals", () => {
    const queue = new PromptQueue();
    const first = queue.add("one", "queue");
    queue.remove(first.id);
    const next = queue.add("two", "queue");
    expect(next.id).toBe(2);
  });

  it("updates item text in place, preserving id and mode", () => {
    const queue = new PromptQueue();
    const item = queue.add("before", "steer");
    expect(queue.update(item.id, "after")).toBe(true);
    expect(queue.items()).toEqual([{ id: item.id, mode: "steer", text: "after" }]);
  });

  it("rejects updates for unknown ids", () => {
    const queue = new PromptQueue();
    queue.add("one", "queue");
    expect(queue.update(99, "nope")).toBe(false);
    expect(queue.items().map((item) => item.text)).toEqual(["one"]);
  });

  it("toggles item mode in both directions, preserving id, text, and position", () => {
    const queue = new PromptQueue();
    const first = queue.add("one", "queue");
    queue.add("two", "steer");
    expect(queue.toggleMode(first.id)).toBe(true);
    expect(queue.items()[0]).toEqual({ id: first.id, mode: "steer", text: "one" });
    expect(queue.toggleMode(first.id)).toBe(true);
    expect(queue.items()[0]).toEqual({ id: first.id, mode: "queue", text: "one" });
    expect(queue.items()[1]?.mode).toBe("steer");
  });

  it("rejects mode toggles for unknown ids", () => {
    const queue = new PromptQueue();
    queue.add("one", "queue");
    expect(queue.toggleMode(99)).toBe(false);
    expect(queue.items()[0]?.mode).toBe("queue");
  });

  it("removes items by id", () => {
    const queue = new PromptQueue();
    const first = queue.add("one", "queue");
    const second = queue.add("two", "queue");
    expect(queue.remove(first.id)).toBe(true);
    expect(queue.remove(first.id)).toBe(false);
    expect(queue.items().map((item) => item.id)).toEqual([second.id]);
  });

  it("moves items earlier and later", () => {
    const queue = new PromptQueue();
    const a = queue.add("a", "queue");
    const b = queue.add("b", "queue");
    const c = queue.add("c", "queue");
    expect(queue.move(c.id, -1)).toBe(true);
    expect(queue.items().map((item) => item.text)).toEqual(["a", "c", "b"]);
    expect(queue.move(a.id, 1)).toBe(true);
    expect(queue.items().map((item) => item.text)).toEqual(["c", "a", "b"]);
    expect(queue.move(b.id, -1)).toBe(true);
    expect(queue.items().map((item) => item.text)).toEqual(["c", "b", "a"]);
  });

  it("rejects moves past either end or for unknown ids", () => {
    const queue = new PromptQueue();
    const a = queue.add("a", "queue");
    const b = queue.add("b", "queue");
    expect(queue.move(a.id, -1)).toBe(false);
    expect(queue.move(b.id, 1)).toBe(false);
    expect(queue.move(42, 1)).toBe(false);
    expect(queue.items().map((item) => item.text)).toEqual(["a", "b"]);
  });

  it("reports steer availability", () => {
    const queue = new PromptQueue();
    expect(queue.hasSteer()).toBe(false);
    queue.add("a", "queue");
    expect(queue.hasSteer()).toBe(false);
    queue.add("b", "steer");
    expect(queue.hasSteer()).toBe(true);
  });

  it("takes the first item regardless of mode", () => {
    const queue = new PromptQueue();
    queue.add("a", "queue");
    queue.add("b", "steer");
    expect(queue.takeFirst()?.text).toBe("a");
    expect(queue.takeFirst()?.text).toBe("b");
    expect(queue.takeFirst()).toBeUndefined();
  });

  it("takes the first steer item, skipping queued ones", () => {
    const queue = new PromptQueue();
    queue.add("a", "queue");
    queue.add("b", "steer");
    queue.add("c", "steer");
    expect(queue.takeFirstSteer()?.text).toBe("b");
    expect(queue.items().map((item) => item.text)).toEqual(["a", "c"]);
    expect(queue.takeFirstSteer()?.text).toBe("c");
    expect(queue.takeFirstSteer()).toBeUndefined();
    expect(queue.size).toBe(1);
  });
});
