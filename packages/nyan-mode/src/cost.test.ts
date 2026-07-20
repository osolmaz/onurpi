import { describe, expect, it } from "vitest";

import { cumulativeApiCost, formatApiCost } from "./cost.ts";

function message(role: string, total: unknown): object {
  return { type: "message", message: { role, usage: { cost: { total } } } };
}

describe("cumulative API cost", () => {
  it("sums finite positive assistant costs", () => {
    expect(
      cumulativeApiCost([
        message("assistant", 1.25),
        message("user", 10),
        message("assistant", 2.5),
        { type: "compaction" },
      ]),
    ).toBe(3.75);
  });

  it("ignores malformed and non-positive costs", () => {
    expect(
      cumulativeApiCost([
        null,
        { type: "message" },
        { type: "message", message: { role: "assistant" } },
        { type: "message", message: { role: "assistant", usage: {} } },
        { type: "message", message: { role: "assistant", usage: { cost: {} } } },
        message("assistant", "2"),
        message("assistant", Number.NaN),
        message("assistant", Number.POSITIVE_INFINITY),
        message("assistant", -1),
        message("assistant", 0),
      ]),
    ).toBe(0);
  });
});

describe("API cost label", () => {
  it("matches Pi's three-decimal display", () => {
    expect(formatApiCost(92.4236, false)).toBe("$92.424");
    expect(formatApiCost(92.4236, true)).toBe("$92.424 (sub)");
  });

  it("shows zero only for subscription-backed models", () => {
    expect(formatApiCost(0, false)).toBeUndefined();
    expect(formatApiCost(Number.NaN, false)).toBeUndefined();
    expect(formatApiCost(-1, true)).toBe("$0.000 (sub)");
  });
});
