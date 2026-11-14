import { describe, expect, it, vi } from "vitest";

import { takeNextQueuedMessage, type QueueSnapshot, type QueuedSession } from "./queue.ts";

function session(snapshot: QueueSnapshot) {
  const steering: string[] = [];
  const followUp: string[] = [];
  const clearQueue = vi.fn(() => snapshot);
  const target: QueuedSession = {
    clearQueue,
    followUp: (text: string) => {
      followUp.push(text);
      return Promise.resolve("queued");
    },
    steer: (text: string) => {
      steering.push(text);
      return Promise.resolve("queued");
    },
  };
  return { clearQueue, followUp, steering, target };
}

describe("takeNextQueuedMessage", () => {
  it("takes the oldest steering message and re-queues the rest in order", () => {
    const { followUp, steering, target } = session({
      followUp: ["follow", "later"],
      steering: ["first", "second"],
    });

    expect(takeNextQueuedMessage(target)).toBe("first");
    expect(steering).toEqual(["second"]);
    expect(followUp).toEqual(["follow", "later"]);
  });

  it("falls back to the oldest follow-up when no steering message waits", () => {
    const { followUp, steering, target } = session({ followUp: ["follow"], steering: [] });

    expect(takeNextQueuedMessage(target)).toBe("follow");
    expect(steering).toEqual([]);
    expect(followUp).toEqual([]);
  });

  it("returns undefined for an empty queue", () => {
    const { clearQueue, followUp, steering, target } = session({ followUp: [], steering: [] });

    expect(takeNextQueuedMessage(target)).toBeUndefined();
    expect(clearQueue).toHaveBeenCalledOnce();
    expect(steering).toEqual([]);
    expect(followUp).toEqual([]);
  });

  it("keeps going when re-queueing one message fails", async () => {
    const rejecting = (text: string) =>
      text.startsWith("doomed")
        ? Promise.reject(new Error("expand failed"))
        : Promise.resolve("queued");
    let snapshot: QueueSnapshot = { followUp: ["kept"], steering: ["doomed-steer"] };
    const target: QueuedSession = {
      clearQueue: () => snapshot,
      followUp: rejecting,
      steer: rejecting,
    };

    expect(takeNextQueuedMessage(target)).toBe("doomed-steer");
    await Promise.resolve();

    snapshot = { followUp: ["doomed-follow"], steering: ["first"] };
    expect(takeNextQueuedMessage(target)).toBe("first");
    await Promise.resolve();
  });
});
