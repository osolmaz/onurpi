import { strict as assert } from "node:assert";

import { describe, it } from "vitest";

import { finalizeResponse, renderResponseOutput } from "../src/response.ts";

describe("finalizeResponse", () => {
  it("preserves full collection metadata after bounding the retained payload", () => {
    const details = finalizeResponse({
      wallTimeSec: 1,
      collected: {
        bytes: new TextEncoder().encode("head\n" + "x".repeat(100 * 1024) + "\ntail\n"),
        totalBytes: 2 * 1024 * 1024,
        totalLines: 100_000,
      },
      signal: null,
      failure: null,
      tty: false,
      logPath: "/tmp/full.log",
    });
    assert.equal(details.original_token_count, (2 * 1024 * 1024) / 4);
    assert.equal(details.truncation?.totalBytes, 2 * 1024 * 1024);
    assert.equal(details.truncation?.totalLines, 100_000);
    assert.ok(Buffer.byteLength(details.output ?? "") <= 50 * 1024);
    assert.match(renderResponseOutput(details), /Full output: \/tmp\/full\.log/);
  });
});
