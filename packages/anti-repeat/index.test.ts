import { describe, expect, it } from "vitest";
import upstream, { ANTI_REPEAT_EVENT_CHANNEL } from "pi-anti-repeat";
import extension from "./index.ts";

describe("Anti-Repeat wrapper", () => {
  it("exports the pinned default extension factory", () => {
    expect(extension).toBeTypeOf("function");
    expect(extension).toBe(upstream);
  });

  it("loads the reviewed protocol", () => {
    expect(ANTI_REPEAT_EVENT_CHANNEL).toBe("anti-repeat");
  });
});
