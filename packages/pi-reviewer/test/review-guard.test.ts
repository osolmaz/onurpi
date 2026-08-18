import { describe, expect, it } from "vitest";

import { toolUnavailableReason } from "../extensions/review-guard.js";

describe("review tool availability", () => {
  it("permits configured review tools during exploration", () => {
    expect(toolUnavailableReason("read", ["read", "submit_review"])).toBeUndefined();
    expect(toolUnavailableReason("submit_review", ["read", "submit_review"])).toBeUndefined();
  });

  it("blocks investigation tools after finalization changes the active set", () => {
    expect(toolUnavailableReason("read", ["submit_review"])).toBe(
      "Tool read is unavailable during review finalization",
    );
    expect(toolUnavailableReason("review_shell", ["submit_review"])).toBe(
      "Tool review_shell is unavailable during review finalization",
    );
  });

  it("continues to reject tools outside read-only review mode", () => {
    expect(toolUnavailableReason("write", ["write", "submit_review"])).toBe(
      "Tool write is unavailable in read-only review mode",
    );
  });
});
