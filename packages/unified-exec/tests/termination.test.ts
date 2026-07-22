import { strict as assert } from "node:assert";

import { describe, it } from "vitest";

import { untrackedLiveSessions } from "../src/termination.ts";

describe("untrackedLiveSessions", () => {
  it("deduplicates stored sessions and ignores exited pending sessions", () => {
    const stored = { hasExited: false, id: 1 };
    const pending = { hasExited: false, id: 2 };
    const exited = { hasExited: true, id: 3 };
    assert.deepEqual(untrackedLiveSessions([stored], [stored, pending, exited]), [pending]);
  });
});
