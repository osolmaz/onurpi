/**
 * Unit tests for HeadTailBuffer.
 *
 * Mirrors codex's head_tail_buffer_tests.rs. Run with:
 *   node --import tsx --test tests/head-tail-buffer.test.ts
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { HeadTailBuffer } from "../src/head-tail-buffer.ts";

function s(str: string): Uint8Array {
	return new TextEncoder().encode(str);
}

function render(buf: HeadTailBuffer): string {
	return new TextDecoder("utf-8").decode(buf.toBytes());
}

describe("HeadTailBuffer", () => {
	it("keeps prefix and suffix when over budget", () => {
		const buf = new HeadTailBuffer(10);

		buf.pushChunk(s("0123456789"));
		assert.equal(buf.omittedBytes, 0);

		// Exceeds max by 2; we should keep head+tail and omit the middle.
		buf.pushChunk(s("ab"));
		assert.ok(buf.omittedBytes > 0, `expected omitted > 0, got ${buf.omittedBytes}`);

		const rendered = render(buf);
		assert.ok(rendered.startsWith("01234"), `rendered=${rendered}`);
		assert.ok(rendered.endsWith("89ab"), `rendered=${rendered}`);
	});

	it("max_bytes zero drops everything", () => {
		const buf = new HeadTailBuffer(0);
		buf.pushChunk(s("abc"));

		assert.equal(buf.retainedBytes, 0);
		assert.equal(buf.omittedBytes, 3);
		assert.equal(render(buf), "");
		assert.deepEqual(buf.snapshotChunks(), []);
	});

	it("head budget zero keeps only last byte in tail", () => {
		const buf = new HeadTailBuffer(1);
		buf.pushChunk(s("abc"));

		assert.equal(buf.retainedBytes, 1);
		assert.equal(buf.omittedBytes, 2);
		assert.equal(render(buf), "c");
	});

	it("draining resets state", () => {
		const buf = new HeadTailBuffer(10);
		buf.pushChunk(s("0123456789"));
		buf.pushChunk(s("ab"));

		const drained = buf.drainChunks();
		assert.ok(drained.length > 0);

		assert.equal(buf.retainedBytes, 0);
		assert.equal(buf.omittedBytes, 0);
		assert.equal(render(buf), "");
	});

	it("chunk larger than tail budget keeps only tail end", () => {
		const buf = new HeadTailBuffer(10);
		buf.pushChunk(s("0123456789"));

		// Tail budget is 5 bytes. This chunk should replace the tail and keep only its last 5 bytes.
		buf.pushChunk(s("ABCDEFGHIJK"));

		const out = render(buf);
		assert.ok(out.startsWith("01234"), `out=${out}`);
		assert.ok(out.endsWith("GHIJK"), `out=${out}`);
		assert.ok(buf.omittedBytes > 0);
	});

	it("fills head then tail across multiple chunks", () => {
		const buf = new HeadTailBuffer(10);

		// Fill the 5-byte head budget across multiple chunks.
		buf.pushChunk(s("01"));
		buf.pushChunk(s("234"));
		assert.equal(render(buf), "01234");

		// Then fill the 5-byte tail budget.
		buf.pushChunk(s("567"));
		buf.pushChunk(s("89"));
		assert.equal(render(buf), "0123456789");
		assert.equal(buf.omittedBytes, 0);

		// One more byte causes the tail to drop its oldest byte.
		buf.pushChunk(s("a"));
		assert.equal(render(buf), "012346789a");
		assert.equal(buf.omittedBytes, 1);
	});

	it("ignores empty chunks", () => {
		const buf = new HeadTailBuffer(10);
		buf.pushChunk(new Uint8Array(0));
		assert.equal(buf.retainedBytes, 0);
		assert.equal(buf.omittedBytes, 0);
	});

	it("snapshot is non-destructive", () => {
		const buf = new HeadTailBuffer(20);
		buf.pushChunk(s("hello"));
		const snap1 = buf.snapshotChunks();
		const snap2 = buf.snapshotChunks();
		assert.equal(snap1.length, snap2.length);
		assert.equal(render(buf), "hello");
	});

	it("handles chunk that exactly fills head budget", () => {
		const buf = new HeadTailBuffer(10);
		buf.pushChunk(s("01234"));
		assert.equal(render(buf), "01234");
		assert.equal(buf.omittedBytes, 0);
		buf.pushChunk(s("56789"));
		assert.equal(render(buf), "0123456789");
		assert.equal(buf.omittedBytes, 0);
	});

	it("chunk spans head/tail boundary", () => {
		const buf = new HeadTailBuffer(10);
		// Head budget is 5; send a 7-byte chunk which should put 5 in head, 2 in tail.
		buf.pushChunk(s("0123456"));
		assert.equal(render(buf), "0123456");
		assert.equal(buf.omittedBytes, 0);
	});

	it("rejects negative max bytes", () => {
		assert.throws(() => new HeadTailBuffer(-1));
	});

	it("rejects NaN max bytes", () => {
		assert.throws(() => new HeadTailBuffer(NaN));
	});

	it("copies input so caller mutations do not affect state", () => {
		const buf = new HeadTailBuffer(10);
		const chunk = s("01234");
		buf.pushChunk(chunk);
		chunk[0] = 0x58; // 'X'
		// Our retained state should still see '0', not 'X'.
		assert.equal(render(buf), "01234");
	});
});
