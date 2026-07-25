import { describe, expect, it } from "vitest";

import {
  decideSendNow,
  decideSettledDelivery,
  decideTurnEndDelivery,
  turnOutcome,
} from "./delivery-policy.ts";

const open = { windowOpen: false, holdReason: undefined };
const both = { hasSteer: true, hasAny: true };

describe("turnOutcome", () => {
  it("classifies terminal stop reasons without matching provider error text", () => {
    expect(turnOutcome("error")).toBe("error");
    expect(turnOutcome("aborted")).toBe("abort");
    expect(turnOutcome("stop")).toBe("completed");
    expect(turnOutcome("toolUse")).toBe("completed");
    expect(turnOutcome(undefined)).toBeUndefined();
  });
});

describe("decideSendNow", () => {
  it("sends directly when idle and aborts before sending when busy", () => {
    expect(decideSendNow(true)).toBe("send");
    expect(decideSendNow(false)).toBe("abort-and-send-on-settle");
  });
});

describe("decideTurnEndDelivery", () => {
  it("delivers a steer item on a normal turn boundary", () => {
    expect(decideTurnEndDelivery(open, both, "completed")).toBe("deliver-steer");
    expect(decideTurnEndDelivery(open, both, undefined)).toBe("deliver-steer");
  });

  it("does nothing without pending steer items", () => {
    expect(decideTurnEndDelivery(open, { hasSteer: false, hasAny: true }, "completed")).toBe(
      "none",
    );
  });

  it("pauses while the manager window is open", () => {
    expect(
      decideTurnEndDelivery({ windowOpen: true, holdReason: undefined }, both, "completed"),
    ).toBe("none");
  });

  it("pauses while delivery has a hold reason", () => {
    expect(
      decideTurnEndDelivery({ windowOpen: false, holdReason: "abort" }, both, "completed"),
    ).toBe("none");
    expect(
      decideTurnEndDelivery({ windowOpen: false, holdReason: "error" }, both, "completed"),
    ).toBe("none");
  });

  it("never delivers on aborted or errored turns", () => {
    expect(decideTurnEndDelivery(open, both, "abort")).toBe("none");
    expect(decideTurnEndDelivery(open, both, "error")).toBe("none");
  });
});

describe("decideSettledDelivery", () => {
  it("delivers the next pending item after a successful settle", () => {
    expect(decideSettledDelivery(open, both, "completed")).toBe("deliver-next");
    expect(decideSettledDelivery(open, { hasSteer: false, hasAny: true }, undefined)).toBe(
      "deliver-next",
    );
  });

  it("returns a reasoned hold when the final turn failed", () => {
    expect(decideSettledDelivery(open, both, "error")).toBe("hold-error");
    expect(decideSettledDelivery(open, both, "abort")).toBe("hold-abort");
    expect(decideSettledDelivery({ windowOpen: true, holdReason: undefined }, both, "error")).toBe(
      "hold-error",
    );
  });

  it("does nothing with an empty queue", () => {
    expect(decideSettledDelivery(open, { hasSteer: false, hasAny: false }, "error")).toBe("none");
  });

  it("pauses successful delivery while the manager is open or a reason is held", () => {
    expect(
      decideSettledDelivery({ windowOpen: true, holdReason: undefined }, both, "completed"),
    ).toBe("none");
    expect(
      decideSettledDelivery({ windowOpen: false, holdReason: "abort" }, both, "completed"),
    ).toBe("none");
  });
});
