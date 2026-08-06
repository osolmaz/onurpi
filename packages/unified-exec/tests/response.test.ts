import { strict as assert } from "node:assert";

import { describe, it } from "vitest";

import { envelopeFromCollected } from "../src/response.ts";
import { finalizeProcessResult, truncationMarker } from "../src/tool-result.ts";

describe("finalizeProcessResult with exact collection metadata", () => {
  it("preserves full collection metadata after bounding the retained payload", () => {
    const collected = {
      bytes: new TextEncoder().encode("head\n" + "x".repeat(100 * 1024) + "\ntail\n"),
      totalBytes: 2 * 1024 * 1024,
      totalLines: 100_000,
    };
    const details = finalizeProcessResult({
      operation: "exec_command",
      wallTimeSec: 1,
      ...envelopeFromCollected(collected),
      sessionId: undefined,
      exitCode: 0,
      signal: null,
      failure: null,
      tty: false,
      logPath: "/tmp/full.log",
    });
    assert.equal(details.original_token_count, (2 * 1024 * 1024) / 4);
    assert.equal(details.omitted_bytes, 2 * 1024 * 1024 - collected.bytes.length);
    assert.equal(details.truncation?.totalBytes, 2 * 1024 * 1024);
    assert.equal(details.truncation?.totalLines, 100_000);
    assert.ok(Buffer.byteLength(details.output) <= 50 * 1024);
    assert.match(
      truncationMarker(details.truncation, details.log_path) ?? "",
      /Full output: \/tmp\/full\.log/,
    );
  });
});
