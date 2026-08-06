/**
 * Unit tests for collectOutputUntilDeadline.
 *
 * Exercises codex's `collect_output_until_deadline` contract:
 *   - returns buffered bytes on deadline
 *   - wakes on notifyAll() and keeps collecting
 *   - exits early when process dies AND stream closes
 *   - gives a short grace after exit before closing
 *   - respects external abort
 */

import { strict as assert } from "node:assert";
import { getEventListeners } from "node:events";
import { describe, it } from "node:test";
import { collectOutputUntilDeadline } from "../src/collect.ts";
import { HeadTailBuffer } from "../src/head-tail-buffer.ts";
import { Gate, Notify, sleep } from "../src/notify.ts";

function s(str: string): Uint8Array {
	return new TextEncoder().encode(str);
}

function text(bytes: Uint8Array): string {
	return new TextDecoder("utf-8").decode(bytes);
}

function makeHarness() {
	const buffer = new HeadTailBuffer(64 * 1024);
	const outputNotify = new Notify();
	const outputClosed = new Gate();
	const exitedAc = new AbortController();
	const externalAc = new AbortController();

	function push(str: string) {
		buffer.pushChunk(s(str));
		outputNotify.notifyAll();
	}

	function exit() {
		exitedAc.abort();
	}

	function closeStream() {
		outputClosed.close();
	}

	return {
		buffer,
		outputNotify,
		outputClosed,
		push,
		exit,
		closeStream,
		exited: exitedAc.signal,
		external: externalAc.signal,
		abortExternal: () => externalAc.abort(),
	};
}

describe("collectOutputUntilDeadline", () => {
	it("does not accumulate abort listeners across chatty iterations", async () => {
		const h = makeHarness();
		// Wake the collector many times within one call. A per-iteration
		// abortPromise()/sleep() implementation leaks one listener + one timer
		// per wakeup (and trips Node's EventTarget max-listener warning at >10).
		const interval = setInterval(() => h.push("x"), 10);
		try {
			const out = await collectOutputUntilDeadline({
				buffer: h.buffer,
				outputNotify: h.outputNotify,
				outputClosed: h.outputClosed,
				exited: h.exited,
				deadlineMs: Date.now() + 400,
				externalAbort: h.external,
			});
			assert.ok(out.bytes.length >= 15, `expected many chunks; got ${out.bytes.length}`);
		} finally {
			clearInterval(interval);
		}
		// All listeners must be released once the call returns.
		assert.equal(getEventListeners(h.exited, "abort").length, 0);
		assert.equal(getEventListeners(h.external, "abort").length, 0);
	});

	it("returns buffered bytes and honors deadline", async () => {
		const h = makeHarness();
		h.push("hello");
		const t0 = Date.now();
		const out = await collectOutputUntilDeadline({
			buffer: h.buffer,
			outputNotify: h.outputNotify,
			outputClosed: h.outputClosed,
			exited: h.exited,
			deadlineMs: t0 + 100,
		});
		const dt = Date.now() - t0;
		assert.equal(text(out.bytes), "hello");
		assert.ok(dt >= 90 && dt < 250, `dt=${dt}`);
	});

	it("keeps collecting after notifyAll during the wait", async () => {
		const h = makeHarness();
		const t0 = Date.now();
		setTimeout(() => h.push("first"), 20);
		setTimeout(() => h.push("second"), 50);
		const out = await collectOutputUntilDeadline({
			buffer: h.buffer,
			outputNotify: h.outputNotify,
			outputClosed: h.outputClosed,
			exited: h.exited,
			deadlineMs: t0 + 200,
		});
		assert.ok(text(out.bytes).includes("first"));
		assert.ok(text(out.bytes).includes("second"));
	});

	it("exits early when process exits AND stream closes", async () => {
		const h = makeHarness();
		h.push("done");
		const t0 = Date.now();
		setTimeout(() => {
			h.exit();
			h.closeStream();
		}, 20);
		const out = await collectOutputUntilDeadline({
			buffer: h.buffer,
			outputNotify: h.outputNotify,
			outputClosed: h.outputClosed,
			exited: h.exited,
			deadlineMs: t0 + 2000,
		});
		const dt = Date.now() - t0;
		assert.equal(text(out.bytes), "done");
		assert.ok(dt < 300, `should have exited well before the 2000ms deadline; dt=${dt}`);
	});

	it("gives a grace period after exit to pick up trailing output", async () => {
		const h = makeHarness();
		const t0 = Date.now();
		// Exit fires first (with no buffered bytes), then trailing output arrives
		// within the grace period, then stream closes.
		setTimeout(() => h.exit(), 20);
		setTimeout(() => h.push("trailing"), 25);
		setTimeout(() => h.closeStream(), 30);
		const out = await collectOutputUntilDeadline({
			buffer: h.buffer,
			outputNotify: h.outputNotify,
			outputClosed: h.outputClosed,
			exited: h.exited,
			deadlineMs: t0 + 2000,
			postExitCloseWaitMs: 100,
		});
		const dt = Date.now() - t0;
		assert.equal(text(out.bytes), "trailing");
		assert.ok(dt < 300, `dt=${dt}`);
	});

	it("stops at the grace cap if stream never closes post-exit", async () => {
		const h = makeHarness();
		const t0 = Date.now();
		setTimeout(() => h.exit(), 20);
		// Never close the stream; we should exit via the grace timer.
		const out = await collectOutputUntilDeadline({
			buffer: h.buffer,
			outputNotify: h.outputNotify,
			outputClosed: h.outputClosed,
			exited: h.exited,
			deadlineMs: t0 + 5000,
			postExitCloseWaitMs: 30,
		});
		const dt = Date.now() - t0;
		assert.equal(text(out.bytes), "");
		assert.ok(dt < 200, `dt=${dt}`);
	});

	it("returns early on external abort", async () => {
		const h = makeHarness();
		const t0 = Date.now();
		setTimeout(() => h.abortExternal(), 30);
		const out = await collectOutputUntilDeadline({
			buffer: h.buffer,
			outputNotify: h.outputNotify,
			outputClosed: h.outputClosed,
			exited: h.exited,
			deadlineMs: t0 + 5000,
			externalAbort: h.external,
		});
		const dt = Date.now() - t0;
		assert.equal(text(out.bytes), "");
		assert.ok(dt < 200, `dt=${dt}`);
	});

	it("handles the case of pre-closed stream", async () => {
		const h = makeHarness();
		h.push("final");
		h.exit();
		h.closeStream();
		const t0 = Date.now();
		const out = await collectOutputUntilDeadline({
			buffer: h.buffer,
			outputNotify: h.outputNotify,
			outputClosed: h.outputClosed,
			exited: h.exited,
			deadlineMs: t0 + 5000,
		});
		const dt = Date.now() - t0;
		assert.equal(text(out.bytes), "final");
		assert.ok(dt < 200, `dt=${dt}`);
	});

	it("polls until deadline with no activity", async () => {
		const h = makeHarness();
		const t0 = Date.now();
		const out = await collectOutputUntilDeadline({
			buffer: h.buffer,
			outputNotify: h.outputNotify,
			outputClosed: h.outputClosed,
			exited: h.exited,
			deadlineMs: t0 + 80,
		});
		const dt = Date.now() - t0;
		assert.equal(text(out.bytes), "");
		assert.ok(dt >= 70 && dt < 250, `dt=${dt}`);
	});

	it("splices an omission marker and reports omitted bytes when retention drops the middle", async () => {
		const buffer = new HeadTailBuffer(16); // tiny cap: 8 head + 8 tail
		const outputNotify = new Notify();
		const outputClosed = new Gate();
		const exitedAc = new AbortController();
		buffer.pushChunk(s("AAAAAAAA")); // fills head
		buffer.pushChunk(s("BBBBBBBBBBBBBBBB")); // overflows: middle dropped
		buffer.pushChunk(s("CCCCCCCC")); // final tail
		exitedAc.abort();
		outputClosed.close();
		const out = await collectOutputUntilDeadline({
			buffer,
			outputNotify,
			outputClosed,
			exited: exitedAc.signal,
			deadlineMs: Date.now() + 1000,
		});
		assert.ok(out.omittedBytes > 0, `expected omitted bytes, got ${out.omittedBytes}`);
		const body = text(out.bytes);
		assert.ok(body.startsWith("AAAAAAAA"), `head must be intact: ${body}`);
		assert.ok(body.endsWith("CCCCCCCC"), `tail must be intact: ${body}`);
		assert.ok(body.includes(`[... ${out.omittedBytes} bytes omitted here`), `marker missing: ${body}`);
		// Marker sits between head and tail, not appended at the end.
		assert.ok(body.indexOf("bytes omitted") < body.indexOf("CCCCCCCC"));
	});

	it("reports zero omitted bytes for small output", async () => {
		const h = makeHarness();
		h.push("tiny");
		h.exit();
		h.closeStream();
		const out = await collectOutputUntilDeadline({
			buffer: h.buffer,
			outputNotify: h.outputNotify,
			outputClosed: h.outputClosed,
			exited: h.exited,
			deadlineMs: Date.now() + 500,
		});
		assert.equal(out.omittedBytes, 0);
		assert.equal(text(out.bytes), "tiny");
	});

	it("drops empty pushes cleanly", async () => {
		const h = makeHarness();
		const t0 = Date.now();
		setTimeout(() => h.push(""), 20);
		setTimeout(() => h.push("real"), 40);
		setTimeout(() => {
			h.exit();
			h.closeStream();
		}, 50);
		const out = await collectOutputUntilDeadline({
			buffer: h.buffer,
			outputNotify: h.outputNotify,
			outputClosed: h.outputClosed,
			exited: h.exited,
			deadlineMs: t0 + 2000,
		});
		assert.equal(text(out.bytes), "real");
	});
});
