import { describe, expect, it } from "vitest";

import { decideIdleDelivery, decideSendNow, decideTurnEndDelivery } from "./delivery-policy.ts";

const open = { windowOpen: false, held: false };
const both = { hasSteer: true, hasAny: true };

describe("decideSendNow", () => {
  it("sends directly when idle and aborts before sending when busy", () => {
    expect(decideSendNow(true)).toBe("send");
    expect(decideSendNow(false)).toBe("abort-and-send-on-settle");
  });
});

describe("decideTurnEndDelivery", () => {
  it("delivers a steer item on a normal turn boundary", () => {
    expect(decideTurnEndDelivery(open, both, "toolUse")).toBe("deliver-steer");
    expect(decideTurnEndDelivery(open, both, "stop")).toBe("deliver-steer");
    expect(decideTurnEndDelivery(open, both, undefined)).toBe("deliver-steer");
  });

  it("does nothing without pending steer items", () => {
    expect(decideTurnEndDelivery(open, { hasSteer: false, hasAny: true }, "stop")).toBe("none");
  });

  it("pauses while the manager window is open", () => {
    expect(decideTurnEndDelivery({ windowOpen: true, held: false }, both, "stop")).toBe("none");
  });

  it("pauses while delivery is held after an abort", () => {
    expect(decideTurnEndDelivery({ windowOpen: false, held: true }, both, "stop")).toBe("none");
  });

  it("never delivers on aborted or errored turns", () => {
    expect(decideTurnEndDelivery(open, both, "aborted")).toBe("none");
    expect(decideTurnEndDelivery(open, both, "error")).toBe("none");
  });
});

describe("decideIdleDelivery", () => {
  it("delivers the next pending item when idle", () => {
    expect(decideIdleDelivery(open, both)).toBe("deliver-next");
    expect(decideIdleDelivery(open, { hasSteer: false, hasAny: true })).toBe("deliver-next");
  });

  it("does nothing with an empty queue", () => {
    expect(decideIdleDelivery(open, { hasSteer: false, hasAny: false })).toBe("none");
  });

  it("pauses while the manager window is open or delivery is held", () => {
    expect(decideIdleDelivery({ windowOpen: true, held: false }, both)).toBe("none");
    expect(decideIdleDelivery({ windowOpen: false, held: true }, both)).toBe("none");
  });
});
