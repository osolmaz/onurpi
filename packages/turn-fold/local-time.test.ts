import { describe, expect, it } from "vitest";

import { formatLocalTimestamp } from "./local-time.ts";

function localTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

describe("local timestamp formatting", () => {
  it("shows hours and minutes for the current local date", () => {
    expect(
      formatLocalTimestamp(localTimestamp(2026, 7, 20, 8, 5), localTimestamp(2026, 7, 20, 23, 59)),
    ).toBe("08:05");
  });

  it("includes the local date for older messages", () => {
    expect(
      formatLocalTimestamp(localTimestamp(2026, 7, 19, 18, 42), localTimestamp(2026, 7, 20, 0, 1)),
    ).toBe("2026-07-19 18:42");
  });

  it("rejects invalid timestamps", () => {
    expect(formatLocalTimestamp(Number.NaN, localTimestamp(2026, 7, 20, 0, 0))).toBe("");
  });
});
