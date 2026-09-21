import { describe, expect, it } from "vitest";

import {
  capChanged,
  configErrorNotice,
  failureNotice,
  listEmpty,
  listHeader,
  rejectNotice,
  statusText,
  stopNotice,
} from "./notice.ts";

describe("rejectNotice", () => {
  it("names focus mode, both counts, and the editor", () => {
    const text = rejectNotice(2, 2);
    expect(text).toBe(
      "Focus mode: 2 of 2 agents are working, so this prompt was not sent. Your text is back in " +
        "the editor. Finish or stop another session, then press Enter again.",
    );
    expect(text.toLowerCase()).toContain("focus mode");
  });

  it("reports one image and several images", () => {
    expect(rejectNotice(2, 2, 1)).toContain("1 image could not be restored.");
    expect(rejectNotice(2, 2, 3)).toContain("3 images could not be restored.");
  });

  it("says when the text could not be restored", () => {
    expect(rejectNotice(2, 2, 0, false)).toContain("could not be put back");
  });
});

describe("stopNotice", () => {
  it("states the working count and the cap", () => {
    const text = stopNotice(3, 2);
    expect(text).toBe("Focus mode stopped this session: 3 agents were working and the cap is 2.");
    expect(text.toLowerCase()).toContain("focus mode");
  });
});

describe("statusText", () => {
  it("renders the counts and the state", () => {
    expect(statusText(2, 2, "held")).toBe("focus 2/2 · held");
    expect(statusText(1, 2, "ready")).toBe("focus 1/2 · ready");
    expect(statusText(2, 2, "full")).toBe("focus 2/2 · full");
  });
});

describe("other messages", () => {
  it("joins config errors", () => {
    expect(configErrorNotice(["a bad", "b bad"])).toBe("Focus mode config: a bad; b bad");
  });

  it("explains a failure and the pass-through", () => {
    expect(failureNotice("no store")).toContain("this prompt was allowed: no store");
  });

  it("describes the list header and the empty list", () => {
    expect(listHeader(1, 2)).toBe("Focus mode: 1 of 2 agents working.");
    expect(listEmpty()).toContain("no other session holds a lease");
  });

  it("confirms a new cap", () => {
    expect(capChanged(1)).toBe("Focus mode cap set to 1 for future sessions.");
  });
});
