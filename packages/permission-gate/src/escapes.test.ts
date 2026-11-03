import { describe, expect, it } from "vitest";

import { decodeEscapes } from "./escapes.ts";

/**
 * The expected values match Unified Exec's decoder, which is what `write_stdin` uses before it
 * writes to a session. They are written out here so this package stays independent of that one.
 */
const CASES: readonly (readonly [string, string])[] = [
  ["plain", "plain"],
  ["\\\\", "\\"],
  ['\\"', '"'],
  ["\\'", "'"],
  ["\\n", "\n"],
  ["\\r", "\r"],
  ["\\t", "\t"],
  ["\\b", "\b"],
  ["\\f", "\f"],
  ["\\v", "\v"],
  ["\\0", "\0"],
  ["\\a", "\x07"],
  ["\\e", "\x1b"],
  ["\\x41", "A"],
  ["\\x1", "\\x1"],
  ["\\xzz", "\\xzz"],
  ["\\u0041", "A"],
  ["\\u12", "\\u12"],
  ["\\u{1f600}", "\u{1f600}"],
  ["\\u{110000}", "\\u{110000}"],
  ["\\u{}", "\\u{}"],
  ["\\u{zz}", "\\u{zz}"],
  ["\\u{1234567}", "\\u{1234567}"],
  ["\\u{41", "\\u{41"],
  ["\\q", "\\q"],
  ["end\\", "end\\"],
  ["C:\\\\tmp", "C:\\tmp"],
];

describe("decodeEscapes", () => {
  it("decodes or keeps each case the way Unified Exec does", () => {
    for (const [input, expected] of CASES)
      expect([input, decodeEscapes(input)]).toEqual([input, expected]);
  });

  it("returns text without a backslash unchanged", () => {
    expect(decodeEscapes("plain")).toBe("plain");
  });
});
