import { describe, expect, it } from "vitest";

import { unescapeChars } from "../../unified-exec/src/unescape.ts";
import { decodeEscapes } from "./escapes.ts";

describe("decodeEscapes", () => {
  it("returns text without a backslash unchanged", () => {
    expect(decodeEscapes("plain")).toBe("plain");
  });

  it("decodes the simple escapes", () => {
    expect(decodeEscapes("\\\\")).toBe("\\");
    expect(decodeEscapes('\\"')).toBe('"');
    expect(decodeEscapes("\\'")).toBe("'");
    expect(decodeEscapes("\\n")).toBe("\n");
    expect(decodeEscapes("\\r")).toBe("\r");
    expect(decodeEscapes("\\t")).toBe("\t");
    expect(decodeEscapes("\\b")).toBe("\b");
    expect(decodeEscapes("\\f")).toBe("\f");
    expect(decodeEscapes("\\v")).toBe("\v");
    expect(decodeEscapes("\\0")).toBe("\0");
    expect(decodeEscapes("\\a")).toBe("\x07");
    expect(decodeEscapes("\\e")).toBe("\x1b");
  });

  it("decodes a hex byte and a four-digit code point", () => {
    expect(decodeEscapes("\\x41")).toBe("A");
    expect(decodeEscapes("\\u0041")).toBe("A");
    expect(decodeEscapes("\\u{1f600}")).toBe("\u{1f600}");
  });

  it("keeps a short hex byte as it stands", () => {
    expect(decodeEscapes("\\x1")).toBe("\\x1");
  });

  it("keeps a non-hex byte as it stands", () => {
    expect(decodeEscapes("\\xzz")).toBe("\\xzz");
  });

  it("keeps a short code point as it stands", () => {
    expect(decodeEscapes("\\u12")).toBe("\\u12");
  });

  it("keeps a code point above the Unicode range as it stands", () => {
    expect(decodeEscapes("\\u{110000}")).toBe("\\u{110000}");
  });

  it("agrees with the Unified Exec decoder on every edge case", () => {
    const cases = [
      "plain",
      "\\\\",
      "\\n",
      "\\r",
      "\\x41",
      "\\x1",
      "\\xzz",
      "\\u0041",
      "\\u12",
      "\\u{1f600}",
      "\\u{110000}",
      "\\q",
      "end\\",
      "C:\\\\tmp",
    ];
    for (const text of cases) expect(decodeEscapes(text)).toBe(unescapeChars(text));
  });

  it("keeps an unknown escape and its backslash", () => {
    expect(decodeEscapes("C:\\\\Users")).toBe("C:\\Users");
    expect(decodeEscapes("\\q")).toBe("\\q");
  });

  it("keeps a trailing backslash", () => {
    expect(decodeEscapes("end\\")).toBe("end\\");
  });
});
