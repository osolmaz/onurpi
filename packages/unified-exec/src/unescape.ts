/**
 * C-style escape decoder for the `chars` parameter of write_stdin.
 *
 * Motivation: antml-style tool call wire formats (and Anthropic/OpenAI JSON
 * tool_use) deliver string parameter values without re-decoding C-style
 * escapes. When the LLM writes `\x03` in a tool call intending "Ctrl-C
 * byte", the string that arrives in the extension is four literal
 * characters: `\`, `x`, `0`, `3`. That means there's no practical way for
 * the model to drive a TUI (vim's ESC, interrupts, arrow keys, …) through
 * the raw `chars` channel alone.
 *
 * This module decodes the common C-style escapes client-side so the LLM can
 * send control bytes via the normal `chars` string. Unknown escapes (`\q`,
 * `\.`, a trailing `\` at EOS, etc.) are preserved verbatim — we don't throw
 * because the mis-escape might be a path on Windows or a regex that the LLM
 * is legitimately forwarding.
 *
 * Supported escapes (value → produced character):
 *   \\           → '\' (0x5C)
 *   \"  \'       → '"', "'"
 *   \n \r \t \b \f \v   → LF CR TAB BS FF VT
 *   \0           → NUL
 *   \a           → BEL (0x07)
 *   \e           → ESC (0x1B)
 *   \xHH         → byte at hex HH (exactly 2 hex digits)
 *   \uHHHH       → Unicode code point (exactly 4 hex digits)
 *   \u{H…H}      → Unicode code point (1–6 hex digits)
 *
 * Anything after a `\` that isn't one of the above is kept literally with
 * the backslash preserved: `\q` → `\q`, `\x1` (short) → `\x1`, trailing
 * `\` at string end → `\`. This matches common shell / C usage where
 * unknown escapes are a hint of user intent rather than an error.
 */

const SIMPLE_ESCAPES: Record<string, string> = {
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

/**
 * Decode C-style escape sequences in `input` and return the resulting string.
 *
 * Raw characters (including real LF / ESC / UTF-8) pass through untouched.
 * UTF-8 encoding of the result is the caller's responsibility.
 */
export function unescapeChars(input: string): string {
	if (!input.includes("\\")) return input; // fast path
	let out = "";
	let i = 0;
	const len = input.length;
	while (i < len) {
		const ch = input[i]!;
		if (ch !== "\\") {
			out += ch;
			i++;
			continue;
		}
		// `\` at end of string — preserve literally.
		if (i + 1 >= len) {
			out += "\\";
			break;
		}
		const next = input[i + 1]!;

		// \xHH — exactly 2 hex digits.
		if (next === "x") {
			const hex = input.slice(i + 2, i + 4);
			if (hex.length === 2 && isHex(hex)) {
				out += String.fromCharCode(parseInt(hex, 16));
				i += 4;
				continue;
			}
			// Short or non-hex — preserve both chars literally, then advance
			// by 1 so the following char gets re-scanned.
			out += "\\x";
			i += 2;
			continue;
		}

		// \u{H…H} — 1..6 hex digits
		if (next === "u" && input[i + 2] === "{") {
			const close = input.indexOf("}", i + 3);
			if (close > i + 2 && close - (i + 3) >= 1 && close - (i + 3) <= 6) {
				const hex = input.slice(i + 3, close);
				if (isHex(hex)) {
					const cp = parseInt(hex, 16);
					if (cp <= 0x10ffff) {
						out += String.fromCodePoint(cp);
						i = close + 1;
						continue;
					}
				}
			}
			out += "\\u";
			i += 2;
			continue;
		}

		// \uHHHH — exactly 4 hex digits.
		if (next === "u") {
			const hex = input.slice(i + 2, i + 6);
			if (hex.length === 4 && isHex(hex)) {
				out += String.fromCharCode(parseInt(hex, 16));
				i += 6;
				continue;
			}
			out += "\\u";
			i += 2;
			continue;
		}

		// Simple one-char escape.
		const mapped = SIMPLE_ESCAPES[next];
		if (mapped !== undefined) {
			out += mapped;
			i += 2;
			continue;
		}

		// Unknown escape — preserve literally.
		out += "\\" + next;
		i += 2;
	}
	return out;
}

function isHex(s: string): boolean {
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (!((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66))) {
			return false;
		}
	}
	return true;
}
