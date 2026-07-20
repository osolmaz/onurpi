import { describe, expect, it } from "vitest";

import { foldDisplay } from "./fold-policy.ts";

describe("fold display policy", () => {
  it("shows only recent activity while compact mode is running", () => {
    expect(
      foldDisplay({
        isLastAssistant: false,
        isRecentActivity: true,
        mode: "compact",
        settled: false,
      }),
    ).toBe("original");
    expect(
      foldDisplay({
        isLastAssistant: true,
        isRecentActivity: false,
        mode: "compact",
        settled: false,
      }),
    ).toBe("hidden");
  });

  it("shows only the last assistant message after compact activity settles", () => {
    expect(
      foldDisplay({
        isLastAssistant: true,
        isRecentActivity: false,
        mode: "compact",
        settled: true,
      }),
    ).toBe("original");
    expect(
      foldDisplay({
        isLastAssistant: false,
        isRecentActivity: true,
        mode: "compact",
        settled: true,
      }),
    ).toBe("hidden");
  });

  it("shows every row in expanded mode", () => {
    expect(
      foldDisplay({
        isLastAssistant: false,
        isRecentActivity: false,
        mode: "expanded",
        settled: true,
      }),
    ).toBe("original");
  });
});
