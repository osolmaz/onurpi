import { strict as assert } from "node:assert";

import { describe, it } from "vitest";

import { refreshPreviewBody } from "../src/render.ts";
import type { RenderState } from "../src/tool-types.ts";

describe("refreshPreviewBody", () => {
  it("preserves the width cache while output is unchanged", () => {
    const state: RenderState = {
      cachedBody: "same",
      cachedWidth: 80,
      cachedLines: ["same"],
      cachedSkipped: 0,
    };
    refreshPreviewBody(state, "same");
    assert.equal(state.cachedWidth, 80);
    assert.deepEqual(state.cachedLines, ["same"]);
  });

  it("invalidates collapsed preview lines when streamed output changes", () => {
    const state: RenderState = {
      cachedBody: "old",
      cachedWidth: 80,
      cachedLines: ["old"],
      cachedSkipped: 3,
    };
    refreshPreviewBody(state, "new");
    assert.equal(state.cachedBody, "new");
    assert.equal(state.cachedWidth, undefined);
    assert.equal(state.cachedLines, undefined);
    assert.equal(state.cachedSkipped, undefined);
  });
});
