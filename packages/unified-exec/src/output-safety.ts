/*
 * Convert untrusted child/argument text into inert terminal text.
 *
 * A PTY can emit more than color: OSC clipboard writes, alternate-screen and
 * keyboard-mode CSI sequences, DCS payloads, and other controls can reprogram
 * the host terminal when replayed by a custom TUI renderer. Unified-exec keeps
 * the exact byte stream in log_path; model/session/TUI output is plain text.
 */

const ESC = "\x1b";

function isCsiParam(code: number): boolean {
	return code >= 0x30 && code <= 0x3f;
}

function isCsiIntermediate(code: number): boolean {
	return code >= 0x20 && code <= 0x2f;
}

function isCsiFinal(code: number): boolean {
	return code >= 0x40 && code <= 0x7e;
}

/** Return the index immediately after a CSI sequence (or malformed suffix). */
function consumeCsi(input: string, start: number): number {
	let i = start;
	while (i < input.length && isCsiParam(input.charCodeAt(i))) i++;
	while (i < input.length && isCsiIntermediate(input.charCodeAt(i))) i++;
	if (i < input.length && isCsiFinal(input.charCodeAt(i))) return i + 1;
	return i;
}

/** Consume OSC/DCS/SOS/PM/APC through ST; OSC also permits BEL. */
function consumeTerminalString(input: string, start: number, allowBel: boolean): number {
	let i = start;
	while (i < input.length) {
		const ch = input[i];
		if (allowBel && ch === "\x07") return i + 1;
		if (ch === ESC && input[i + 1] === "\\") return i + 2;
		if (ch === "\x9c") return i + 1;
		i++;
	}
	return i;
}

/**
 * Strip ANSI/VT sequences and C0/C1 controls while retaining printable text,
 * tabs, and newlines. Carriage return is removed so progress output cannot
 * rewrite an earlier portion of a rendered transcript line.
 */
export function sanitizeOutputText(input: string): string {
	// Newline/tab-only text is overwhelmingly common; avoid a code-point scan.
	if (!/[\x00-\x08\x0b-\x1f\x7f-\x9f\ud800-\udfff\ufff9-\ufffb]/.test(input)) return input;

	let output = "";
	let i = 0;

	while (i < input.length) {
		const ch = input[i]!;
		const code = input.charCodeAt(i);

		if (
			ch === ESC ||
			code === 0x90 ||
			code === 0x98 ||
			code === 0x9b ||
			code === 0x9d ||
			code === 0x9e ||
			code === 0x9f
		) {
			const rawCsi = code === 0x9b;
			const rawOsc = code === 0x9d;
			const rawString = code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f;
			const next = rawCsi || rawOsc || rawString ? "" : input[i + 1];

			if (rawCsi || next === "[") {
				i = consumeCsi(input, rawCsi ? i + 1 : i + 2);
				continue;
			}
			if (rawOsc || next === "]") {
				i = consumeTerminalString(input, rawOsc ? i + 1 : i + 2, true);
				continue;
			}
			if (rawString) {
				i = consumeTerminalString(input, i + 1, false);
				continue;
			}
			if (next === "P" || next === "X" || next === "^" || next === "_") {
				i = consumeTerminalString(input, i + 2, false);
				continue;
			}

			// Remaining ESC forms are optional intermediate bytes followed by one
			// final byte (charset selection, keypad modes, RIS, and similar).
			let end = i + 1;
			while (end < input.length && isCsiIntermediate(input.charCodeAt(end))) end++;
			i = end < input.length ? end + 1 : input.length;
			continue;
		}

		if (
			(code < 0x20 && ch !== "\n" && ch !== "\t") ||
			code === 0x7f ||
			(code >= 0x80 && code <= 0x9f) ||
			(code >= 0xfff9 && code <= 0xfffb)
		) {
			i++;
			continue;
		}

		// Keep valid surrogate pairs and drop lone halves, which can crash
		// terminal-width libraries when untrusted binary data is decoded.
		if (code >= 0xd800 && code <= 0xdbff) {
			const nextCode = input.charCodeAt(i + 1);
			if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
				output += input.slice(i, i + 2);
				i += 2;
				continue;
			}
			i++;
			continue;
		}
		if (code >= 0xdc00 && code <= 0xdfff) {
			i++;
			continue;
		}

		output += ch;
		i++;
	}

	return output;
}
