/**
 * Guards for the PTY provider package:
 *
 * 1. When EXPECT_PTY=1 (set in CI for all matrix platforms), assert the
 *    @homebridge/node-pty-prebuilt-multiarch module actually loads. Without
 *    this, a prebuild/load failure silently skips the whole PTY e2e suite
 *    and CI stays green while tty:true is broken.
 *
 * 2. disposeWindowsConpty pokes undocumented node-pty internals
 *    (_agent._conoutSocketWorker etc.); a mock-agent test locks the calls
 *    it must make and its tolerance for missing fields.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { disposeWindowsConpty, getPtyLoadError, isPtyAvailable } from "../src/pty.ts";

describe("PTY module loading", () => {
	it("loads when EXPECT_PTY=1", { skip: process.env.EXPECT_PTY !== "1" }, () => {
		assert.equal(isPtyAvailable(), true, `PTY module failed to load: ${getPtyLoadError()}`);
	});

	it("reports a load error message when unavailable", () => {
		if (isPtyAvailable()) {
			assert.equal(getPtyLoadError(), undefined);
		} else {
			assert.match(getPtyLoadError() ?? "", /node-pty-prebuilt-multiarch/);
		}
	});
});

describe("disposeWindowsConpty", () => {
	it("destroys both sockets and disposes the conout worker", () => {
		const calls: string[] = [];
		const child = {
			_agent: {
				_inSocket: { destroy: () => calls.push("in") },
				_outSocket: { destroy: () => calls.push("out") },
				_conoutSocketWorker: { dispose: () => calls.push("worker") },
			},
		};
		disposeWindowsConpty(child);
		assert.deepEqual(calls.sort(), ["in", "out", "worker"]);
	});

	it("tolerates missing agent or fields (undocumented internals may change)", () => {
		disposeWindowsConpty(undefined);
		disposeWindowsConpty({});
		disposeWindowsConpty({ _agent: {} });
		disposeWindowsConpty({ _agent: { _inSocket: {}, _outSocket: null } });
	});

	it("swallows exceptions from the internals", () => {
		disposeWindowsConpty({
			_agent: {
				_inSocket: {
					destroy: () => {
						throw new Error("boom");
					},
				},
			},
		});
	});
});
