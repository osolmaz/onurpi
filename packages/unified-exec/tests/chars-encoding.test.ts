/**
 * Probe: what bytes does write_stdin actually deliver to the child for various
 * `chars` inputs?
 *
 * Since the wire-format bug was fixed (see commit history), `chars` is
 * documented as a C-style escape string:
 *   - Raw bytes in the JS string pass through untouched (UTF-8 encoded).
 *   - Literal backslash escapes (`\\x03`, `\\n`, `\\u001b`, etc.) are
 *     DECODED into the bytes they name by src/unescape.ts.
 *   - `chars_b64` is the binary-safe sibling parameter for exact byte
 *     control with no decoding.
 *
 * These tests pin both channels end-to-end through the real tool pipeline.
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import extensionFactory from "../src/index.ts";

interface ToolDef {
	name: string;
	execute: (
		toolCallId: string,
		params: any,
		signal: AbortSignal | undefined,
		onUpdate: any,
		ctx: any,
	) => Promise<{ content: Array<{ type: string; text: string }>; details: any }>;
}

function makeHarness() {
	const tools: Record<string, ToolDef> = {};
	const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
	const stubCtx = {
		cwd: process.cwd(),
		ui: {
			notify: (_m: string) => {},
			setStatus: (_k: string, _v: unknown) => {},
		},
		hasUI: false,
	};
	const pi = {
		registerTool: (def: ToolDef) => {
			tools[def.name] = def;
		},
		on: (event: string, handler: (e: any, ctx: any) => any) => {
			(handlers[event] ??= []).push(handler);
		},
		registerCommand: () => {},
		registerShortcut: () => {},
		registerFlag: () => {},
		registerMessageRenderer: () => {},
		getFlag: () => false,
		getActiveTools: () => ["bash"],
		setActiveTools: () => {},
	};
	(extensionFactory as any)(pi);
	return {
		async call(toolName: string, params: any, signal?: AbortSignal) {
			const def = tools[toolName];
			if (!def) throw new Error(`no such tool: ${toolName}`);
			return def.execute("test-call-id", params, signal, undefined, stubCtx);
		},
		async emit(event: string, evt: any = {}) {
			for (const h of handlers[event] ?? []) await h(evt, stubCtx);
		},
	};
}

/**
 * Spawn `cat > <tmpfile>` so every byte we write_stdin lands in the file
 * verbatim. Returns helpers to push chars and read back the captured bytes.
 */
async function spawnCapture() {
	const dir = mkdtempSync(join(tmpdir(), "unified-exec-chars-"));
	const out = join(dir, "stdin.bin");
	const h = makeHarness();
	await h.emit("session_start");
	const r1 = await h.call("exec_command", {
		cmd: `cat > '${out}'`,
		yield_time_ms: 300,
	});
	assert.ok(typeof r1.details.session_id === "number", `expected session_id; got ${JSON.stringify(r1.details)}`);
	const sid = r1.details.session_id as number;
	return {
		sid,
		outFile: out,
		dir,
		harness: h,
		async send(chars: string) {
			await h.call("write_stdin", { session_id: sid, chars, yield_time_ms: 250 });
		},
		async finish(): Promise<Buffer> {
			// Force-kill the cat session so the tmpfile is closed and flushed.
			await h.call("kill_session", { session_id: sid });
			// Brief settle.
			await new Promise((r) => setTimeout(r, 50));
			const buf = readFileSync(out);
			await h.emit("session_shutdown");
			rmSync(dir, { recursive: true, force: true });
			return buf;
		},
	};
}

describe("write_stdin chars encoding", () => {
	it("writes a real LF (0x0A) when chars contains a real LF", async () => {
		const c = await spawnCapture();
		// JS string literally contains an LF character.
		await c.send("A\nB");
		const buf = await c.finish();
		assert.deepEqual([...buf], [0x41, 0x0a, 0x42], `bytes=${[...buf].map((b) => b.toString(16))}`);
	});

	it("writes a real ESC (0x1B) when chars contains a real ESC", async () => {
		const c = await spawnCapture();
		// "\u001b" in JS source code is one char, U+001B (ESC).
		await c.send("A\u001bB");
		const buf = await c.finish();
		assert.deepEqual([...buf], [0x41, 0x1b, 0x42], `bytes=${[...buf].map((b) => b.toString(16))}`);
	});

	it("writes a real Ctrl-C (0x03) when chars contains it", async () => {
		const c = await spawnCapture();
		await c.send("\u0003");
		const buf = await c.finish();
		assert.deepEqual([...buf], [0x03], `bytes=${[...buf].map((b) => b.toString(16))}`);
	});

	it("decodes \\n (backslash + n) into a real LF byte", async () => {
		const c = await spawnCapture();
		await c.send("A\\nB");
		const buf = await c.finish();
		assert.deepEqual([...buf], [0x41, 0x0a, 0x42], `bytes=${[...buf].map((b) => b.toString(16))}`);
	});

	it("decodes \\x1b (4 chars) into a real ESC byte", async () => {
		const c = await spawnCapture();
		await c.send("A\\x1bB");
		const buf = await c.finish();
		assert.deepEqual([...buf], [0x41, 0x1b, 0x42], `bytes=${[...buf].map((b) => b.toString(16))}`);
	});

	it("decodes \\u001b (6 chars) into a real ESC byte", async () => {
		const c = await spawnCapture();
		await c.send("A\\u001bB");
		const buf = await c.finish();
		assert.deepEqual([...buf], [0x41, 0x1b, 0x42], `bytes=${[...buf].map((b) => b.toString(16))}`);
	});

	it("decodes \\x03 (Ctrl-C) into a real 0x03 byte", async () => {
		const c = await spawnCapture();
		await c.send("\\x03");
		const buf = await c.finish();
		assert.deepEqual([...buf], [0x03], `bytes=${[...buf].map((b) => b.toString(16))}`);
	});

	it("decodes \\\\ into a single literal backslash (0x5C)", async () => {
		const c = await spawnCapture();
		await c.send("\\\\");
		const buf = await c.finish();
		assert.deepEqual([...buf], [0x5c], `bytes=${[...buf].map((b) => b.toString(16))}`);
	});

	it("full vim-escape sequence \\x1b:wq\\n lands as 5 bytes", async () => {
		const c = await spawnCapture();
		await c.send("\\x1b:wq\\n");
		const buf = await c.finish();
		assert.deepEqual([...buf], [0x1b, 0x3a, 0x77, 0x71, 0x0a], `bytes=${[...buf].map((b) => b.toString(16))}`);
	});

	it("UTF-8 multi-byte chars are passed through verbatim", async () => {
		const c = await spawnCapture();
		await c.send("é"); // U+00E9 → 0xC3 0xA9 in UTF-8
		const buf = await c.finish();
		assert.deepEqual([...buf], [0xc3, 0xa9], `bytes=${[...buf].map((b) => b.toString(16))}`);
	});

	it("chars_b64 delivers the exact decoded bytes (binary-safe)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "unified-exec-chars-"));
		const out = join(dir, "stdin.bin");
		const h = makeHarness();
		await h.emit("session_start");
		const r1 = await h.call("exec_command", { cmd: `cat > '${out}'`, yield_time_ms: 300 });
		const sid = r1.details.session_id as number;
		const b64 = Buffer.from([0x1b, 0x03, 0x41, 0x0a, 0xc3, 0xa9]).toString("base64");
		await h.call("write_stdin", { session_id: sid, chars_b64: b64, yield_time_ms: 250 });
		await h.call("kill_session", { session_id: sid });
		await new Promise((r) => setTimeout(r, 50));
		const buf = readFileSync(out);
		assert.deepEqual([...buf], [0x1b, 0x03, 0x41, 0x0a, 0xc3, 0xa9]);
		await h.emit("session_shutdown");
		rmSync(dir, { recursive: true, force: true });
	});

	it("passing both chars and chars_b64 rejects the call", async () => {
		const h = makeHarness();
		await h.emit("session_start");
		const r1 = await h.call("exec_command", { cmd: "cat > /dev/null", yield_time_ms: 200 });
		const sid = r1.details.session_id as number;
		await assert.rejects(
			() => h.call("write_stdin", { session_id: sid, chars: "hi", chars_b64: "aGk=" }),
			/either `chars` or `chars_b64`/,
		);
		await h.call("kill_session", { session_id: sid });
		await h.emit("session_shutdown");
	});

	it("malformed base64 rejects the call", async () => {
		const h = makeHarness();
		await h.emit("session_start");
		const r1 = await h.call("exec_command", { cmd: "cat > /dev/null", yield_time_ms: 200 });
		const sid = r1.details.session_id as number;
		await assert.rejects(
			() => h.call("write_stdin", { session_id: sid, chars_b64: "not@valid!" }),
			/not valid base64/,
		);
		await h.call("kill_session", { session_id: sid });
		await h.emit("session_shutdown");
	});
});
