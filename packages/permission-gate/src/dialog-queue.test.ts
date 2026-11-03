import { describe, expect, it } from "vitest";

import { createDialogQueue } from "./dialog-queue.ts";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = () => {
      settle();
    };
  });
  return { promise, resolve };
}

describe("createDialogQueue", () => {
  it("runs one task at a time, in order", async () => {
    const queue = createDialogQueue();
    const gate = deferred();
    const started: string[] = [];

    const first = queue.run(async () => {
      started.push("first");
      await gate.promise;
      return "a";
    });
    const second = queue.run(() => {
      started.push("second");
      return Promise.resolve("b");
    });

    await Promise.resolve();
    expect(started).toEqual(["first"]);

    gate.resolve();
    expect(await first).toBe("a");
    expect(await second).toBe("b");
    expect(started).toEqual(["first", "second"]);
  });

  it("keeps running after a task fails", async () => {
    const queue = createDialogQueue();
    await expect(queue.run(() => Promise.reject(new Error("dialog failed")))).rejects.toThrow(
      "dialog failed",
    );
    expect(await queue.run(() => Promise.resolve("next"))).toBe("next");
  });
});
