import { describe, expect, it } from "vitest";

import commandGuard from "./index.ts";

describe("Command Guard extension", () => {
  it("exports a Pi extension factory", () => {
    expect(typeof commandGuard).toBe("function");
  });
});
