/**
 * Unit tests for Notify / Gate / sleep.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Gate, Notify, sleep } from "../src/notify.ts";

describe("Notify", () => {
	it("resolves pending waiters on notifyAll", async () => {
		const n = new Notify();
		const a = n.notified();
		const b = n.notified();
		n.notifyAll();
		await a;
		await b;
	});

	it("does not backlog: notify without waiter is lost", async () => {
		const n = new Notify();
		n.notifyAll(); // nobody waiting
		const a = n.notified();
		let resolved = false;
		a.then(() => {
			resolved = true;
		});
		await sleep(20);
		assert.equal(resolved, false, "waiter should still be parked");
		n.notifyAll();
		await a;
		assert.equal(resolved, true);
	});

	it("only wakes waiters created before notifyAll", async () => {
		const n = new Notify();
		const pre = n.notified();
		n.notifyAll();
		await pre;
		// A new waiter after notifyAll should not resolve until the next notify.
		const post = n.notified();
		let resolved = false;
		post.then(() => {
			resolved = true;
		});
		await sleep(10);
		assert.equal(resolved, false);
		n.notifyAll();
		await post;
	});
});

describe("Gate", () => {
	it("starts open and closes idempotently", async () => {
		const g = new Gate();
		assert.equal(g.isClosed, false);
		g.close();
		assert.equal(g.isClosed, true);
		g.close();
		assert.equal(g.isClosed, true);
	});

	it("releases all waiters on close", async () => {
		const g = new Gate();
		const a = g.closed();
		const b = g.closed();
		g.close();
		await a;
		await b;
	});

	it("closed() after close resolves immediately", async () => {
		const g = new Gate();
		g.close();
		const t0 = Date.now();
		await g.closed();
		assert.ok(Date.now() - t0 < 20);
	});
});

describe("sleep", () => {
	it("waits approximately the requested duration", async () => {
		const t0 = Date.now();
		await sleep(50);
		const dt = Date.now() - t0;
		assert.ok(dt >= 40 && dt < 200, `dt=${dt}`);
	});

	it("resolves immediately on <=0", async () => {
		const t0 = Date.now();
		await sleep(0);
		await sleep(-1);
		assert.ok(Date.now() - t0 < 10);
	});

	it("honors abort signal mid-sleep", async () => {
		const ac = new AbortController();
		setTimeout(() => ac.abort(), 20);
		const t0 = Date.now();
		await sleep(500, ac.signal);
		const dt = Date.now() - t0;
		assert.ok(dt < 200, `dt=${dt}`);
	});

	it("resolves immediately if already aborted", async () => {
		const ac = new AbortController();
		ac.abort();
		const t0 = Date.now();
		await sleep(500, ac.signal);
		assert.ok(Date.now() - t0 < 10);
	});
});
