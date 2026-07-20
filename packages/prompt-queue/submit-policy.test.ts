import { describe, expect, it } from "vitest";

import { decideForcedEnqueue, decideSubmit, shouldOpenManagerOnUp } from "./submit-policy.ts";

describe("decideSubmit", () => {
  it("ignores blank submissions", () => {
    expect(decideSubmit("", true)).toBe("ignore");
    expect(decideSubmit("   \n ", false)).toBe("ignore");
  });

  it("passes prompts through when the agent is idle", () => {
    expect(decideSubmit("hello", false)).toBe("pass");
  });

  it("enqueues plain prompts while the agent is busy", () => {
    expect(decideSubmit("hello", true)).toBe("enqueue");
  });

  it("always passes slash commands and bash directives through", () => {
    expect(decideSubmit("/compact", true)).toBe("pass");
    expect(decideSubmit("!ls", true)).toBe("pass");
    expect(decideSubmit("  /model", true)).toBe("pass");
    expect(decideSubmit("/compact", false)).toBe("pass");
  });
});

describe("decideForcedEnqueue", () => {
  it("enqueues plain prompts while busy", () => {
    expect(decideForcedEnqueue("hello", true, false)).toBe("enqueue");
  });

  it("defaults when idle, blank, or autocomplete is open", () => {
    expect(decideForcedEnqueue("hello", false, false)).toBe("default");
    expect(decideForcedEnqueue("  ", true, false)).toBe("default");
    expect(decideForcedEnqueue("hello", true, true)).toBe("default");
  });

  it("defaults for slash commands and bash directives", () => {
    expect(decideForcedEnqueue("/compact", true, false)).toBe("default");
    expect(decideForcedEnqueue("!ls", true, false)).toBe("default");
  });
});

describe("shouldOpenManagerOnUp", () => {
  it("opens only when the editor is empty", () => {
    expect(shouldOpenManagerOnUp("")).toBe(true);
    expect(shouldOpenManagerOnUp("  \n ")).toBe(true);
    expect(shouldOpenManagerOnUp("draft")).toBe(false);
  });
});
