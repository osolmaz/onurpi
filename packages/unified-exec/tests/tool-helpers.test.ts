import { strict as assert } from "node:assert";

import { describe, it } from "vitest";

import {
  resolveEmptyPollYield,
  resolveMaxEmptyPollMs,
  resolveWriteInput,
} from "../src/tool-helpers.ts";

describe("empty poll durations", () => {
  it("accepts relative waits longer than the former 290-second limit", () => {
    assert.equal(resolveMaxEmptyPollMs({}), undefined);
    assert.equal(resolveEmptyPollYield(600_000, {}), 600_000);
    assert.equal(resolveEmptyPollYield(undefined, {}), 5_000);
    assert.equal(resolveEmptyPollYield(0, {}), 5_000);
  });

  it("enforces an optional limit above 290 seconds", () => {
    const env = { PI_UNIFIED_EXEC_MAX_EMPTY_POLL_MS: "600000" };
    assert.equal(resolveMaxEmptyPollMs(env), 600_000);
    assert.equal(resolveEmptyPollYield(600_000, env), 600_000);
    assert.throws(() => resolveEmptyPollYield(600_001, env), /configured empty-poll cap/);
  });

  it("rejects invalid explicit limits and unsafe durations", () => {
    for (const raw of ["broken", "-1", "Infinity", String(Number.MAX_SAFE_INTEGER + 1)]) {
      assert.throws(
        () => resolveMaxEmptyPollMs({ PI_UNIFIED_EXEC_MAX_EMPTY_POLL_MS: raw }),
        /positive finite duration/,
      );
    }
    for (const value of [-1, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => resolveEmptyPollYield(value, {}), /non-negative finite duration/);
    }
  });
});

describe("resolveWriteInput", () => {
  it("decodes complete padded and unpadded base64 quanta", () => {
    assert.deepEqual(
      Array.from(resolveWriteInput({ session_id: 1, chars_b64: "TQ==" }) ?? []),
      [77],
    );
    assert.deepEqual(
      Array.from(resolveWriteInput({ session_id: 1, chars_b64: "TWE=" }) ?? []),
      [77, 97],
    );
    assert.deepEqual(
      Array.from(resolveWriteInput({ session_id: 1, chars_b64: "TWFu" }) ?? []),
      [77, 97, 110],
    );
    assert.deepEqual(
      Array.from(resolveWriteInput({ session_id: 1, chars_b64: "  T W F u\n" }) ?? []),
      [77, 97, 110],
    );
  });

  it("rejects incomplete or impossible base64 quanta", () => {
    for (const chars_b64 of ["A", "A=", "A===", "====", "abcde", " "]) {
      assert.throws(
        () => resolveWriteInput({ session_id: 1, chars_b64 }),
        /not valid base64/,
        chars_b64,
      );
    }
  });

  it("decodes C-style text input", () => {
    assert.deepEqual(
      resolveWriteInput({ session_id: 1, chars: "A\\n\\x03" }),
      new Uint8Array([65, 10, 3]),
    );
  });

  it("rejects simultaneous text and binary input", () => {
    assert.throws(
      () => resolveWriteInput({ session_id: 1, chars: "x", chars_b64: "eA==" }),
      /either `chars` or `chars_b64`/,
    );
  });
});
