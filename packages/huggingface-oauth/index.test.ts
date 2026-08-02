import { describe, expect, it } from "vitest";
import extension from "./index.ts";

describe("Hugging Face OAuth wrapper", () => {
  it("exports the pinned extension factory", () => {
    expect(extension).toBeTypeOf("function");
  });
});
