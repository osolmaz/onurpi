import { describe, expect, it } from "vitest";
import extension from "./index.ts";

describe("Pi Workflows wrapper", () => {
  it("exports the pinned extension factory", () => {
    expect(extension).toBeTypeOf("function");
  });
});
