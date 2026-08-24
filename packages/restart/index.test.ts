import { describe, expect, it } from "vitest";

import restartExtension from "./index.ts";

describe("restart extension", () => {
  it("exports a Pi extension factory", () => {
    expect(restartExtension).toBeTypeOf("function");
  });
});
