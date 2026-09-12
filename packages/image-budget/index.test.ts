import { describe, expect, it } from "vitest";

import imageBudget from "./index.ts";

describe("image-budget extension", () => {
  it("exports a Pi extension factory", () => {
    expect(typeof imageBudget).toBe("function");
    expect(imageBudget).toHaveLength(1);
  });
});
