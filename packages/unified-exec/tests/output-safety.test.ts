import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { sanitizeOutputText } from "../src/output-safety.ts";

describe("sanitizeOutputText", () => {
	it("strips SGR and terminal-mode CSI sequences while retaining text", () => {
		assert.equal(
			sanitizeOutputText("before\x1b[31mred\x1b[0m\x1b[?1049h\x1b[>7uafter"),
			"beforeredafter",
		);
	});

	it("strips OSC clipboard/title strings with BEL or ST terminators", () => {
		assert.equal(
			sanitizeOutputText("a\x1b]52;c;YXR0YWNrZXI=\x07b\x1b]0;title\x1b\\c"),
			"abc",
		);
	});

	it("strips DCS, 8-bit CSI, and remaining C0/C1 controls", () => {
		assert.equal(sanitizeOutputText("a\x1bPpayload\x1b\\b\x9b2Jc\x00\x07\x7fd"), "abcd");
	});

	it("keeps tabs and newlines but removes carriage returns", () => {
		assert.equal(sanitizeOutputText("a\tb\rprogress\nc"), "a\tbprogress\nc");
	});

	it("preserves valid Unicode while removing lone surrogates and unsafe format controls", () => {
		assert.equal(sanitizeOutputText("a🎉\ud800b\udc00c\ufff9d"), "a🎉bcd");
	});

	it("swallows an unterminated terminal string instead of leaking its payload", () => {
		assert.equal(sanitizeOutputText("safe\x1b]52;c;secret"), "safe");
	});
});
