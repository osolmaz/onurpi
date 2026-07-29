/**
 * Unit tests for the numeric-signal → SIG* name mapping in src/pty.ts.
 *
 * Regression: the map used to be a hand-picked 6-entry table, so tty-mode
 * children killed by SIGSEGV / SIGPIPE / SIGUSR1 were reported as exit_code=0.
 * The map is now built from the platform's full `os.constants.signals` table.
 */

import { strict as assert } from "node:assert";
import { constants } from "node:os";
import { describe, it } from "node:test";
import { signalNameFromNumber } from "../src/pty.ts";

describe("signalNameFromNumber", () => {
	it("maps common signals from the platform table", () => {
		assert.equal(signalNameFromNumber(constants.signals.SIGTERM), "SIGTERM");
		assert.equal(signalNameFromNumber(constants.signals.SIGKILL), "SIGKILL");
		assert.equal(signalNameFromNumber(constants.signals.SIGINT), "SIGINT");
		assert.equal(signalNameFromNumber(constants.signals.SIGHUP), "SIGHUP");
	});

	it("maps crash/IO signals that the old hand-picked table missed", () => {
		// Windows' os.constants.signals lacks SIGPIPE/SIGUSR1/SIGUSR2 — only
		// assert the signals the platform actually defines.
		for (const name of ["SIGSEGV", "SIGPIPE", "SIGUSR1", "SIGUSR2"] as const) {
			const num = constants.signals[name];
			if (num === undefined) continue;
			assert.equal(signalNameFromNumber(num), name);
		}
	});

	it("returns null for unknown numbers", () => {
		assert.equal(signalNameFromNumber(0), null);
		assert.equal(signalNameFromNumber(999), null);
	});
});
