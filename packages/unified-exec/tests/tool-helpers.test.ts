import { strict as assert } from "node:assert";

import { describe, it } from "vitest";

import { resolveWriteInput } from "../src/tool-helpers.ts";

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
