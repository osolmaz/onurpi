/**
 * C-style escape decoder for the text that `write_stdin` writes to a session. Unified Exec decodes
 * these escapes before it writes the bytes, so the approval dialog must show the bytes rather than
 * the letters. An unknown escape keeps its backslash, exactly as Unified Exec keeps it.
 */
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\",
  '"': '"',
  "'": "'",
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
  a: "\x07",
  e: "\x1b",
};

const HEX_DIGITS = /^[0-9a-f]+$/iu;

export type Decoded = { text: string; length: number };

export function decodeEscapes(text: string): string {
  if (!text.includes("\\")) return text;
  let result = "";
  let index = 0;
  while (index < text.length) {
    if (text.charAt(index) !== "\\") {
      result += text.charAt(index);
      index += 1;
      continue;
    }
    const decoded = decodeEscape(text, index);
    result += decoded.text;
    index += decoded.length;
  }
  return result;
}

function decodeEscape(text: string, index: number): Decoded {
  const next = text.charAt(index + 1);
  if (next === "") return { text: "\\", length: 1 };
  const simple = SIMPLE_ESCAPES[next];
  if (simple !== undefined) return { text: simple, length: 2 };
  if (next === "x") return decodeHexByte(text, index);
  if (next === "u") return decodeCodePoint(text, index);
  return { text: `\\${next}`, length: 2 };
}

function decodeHexByte(text: string, index: number): Decoded {
  const digits = text.slice(index + 2, index + 4);
  const literal = { text: "\\x", length: 2 };
  if (digits.length !== 2 || !HEX_DIGITS.test(digits)) return literal;
  return { text: String.fromCharCode(Number.parseInt(digits, 16)), length: 4 };
}

function decodeCodePoint(text: string, index: number): Decoded {
  const braced = /^\{([0-9a-f]{1,6})\}/iu.exec(text.slice(index + 2));
  if (braced?.[1] !== undefined) {
    const code = Number.parseInt(braced[1], 16);
    if (code <= 0x10ffff) {
      return { text: String.fromCodePoint(code), length: 2 + braced[0].length };
    }
    return { text: "\\u", length: 2 };
  }
  const digits = text.slice(index + 2, index + 6);
  if (digits.length !== 4 || !HEX_DIGITS.test(digits)) return { text: "\\u", length: 2 };
  return { text: String.fromCharCode(Number.parseInt(digits, 16)), length: 6 };
}
