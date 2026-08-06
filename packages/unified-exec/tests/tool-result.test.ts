import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";

import {
	finalizeKillResult,
	finalizeProcessResult,
	renderKillResultText,
	renderProcessResultText,
} from "../src/tool-result.ts";

const encoder = new TextEncoder();

describe("bounded tool results", () => {
	it("preserves the existing process response contract with explicit operation state", () => {
		const details = finalizeProcessResult({
			operation: "exec_command",
			wallTimeSec: 0.25,
			collected: encoder.encode("hello\nworld\n"),
			totalBytes: 12,
			sessionId: 7,
			exitCode: undefined,
			signal: null,
			failure: null,
			tty: false,
			logPath: "/tmp/session.log",
			cwd: "/tmp",
			command: "printf hello",
			yieldTimeMs: 250,
		});

		assert.equal(details.operation, "exec_command");
		assert.equal(details.status, "running");
		assert.equal(details.running, true);
		assert.equal(details.session_id, 7);
		assert.equal(details.output, "hello\nworld\n");
		assert.match(renderProcessResultText(details), /^\[still running\]/);
	});

	it("bounds kill output and puts the recovery marker in model-visible text", () => {
		const raw = Array.from({ length: DEFAULT_MAX_LINES + 1000 }, (_, index) => `line-${index + 1}`).join("\n");
		const details = finalizeKillResult({
			wallTimeSec: 0.5,
			collected: encoder.encode(raw),
			totalBytes: Buffer.byteLength(raw),
			sessionId: 42,
			pid: 1234,
			requestedSignal: "SIGTERM",
			exitCode: undefined,
			signal: "SIGTERM",
			failure: null,
			tty: false,
			logPath: "/tmp/full.log",
			cwd: "/repo",
			command: "noisy-job",
			escalated: false,
			killed: true,
		});

		assert.equal(details.operation, "kill_session");
		assert.equal(details.status, "killed");
		assert.equal(details.running, false);
		assert.equal(details.killed, true);
		assert.ok(Buffer.byteLength(details.output, "utf8") <= DEFAULT_MAX_BYTES);
		assert.equal(details.truncation?.truncated, true);
		assert.equal(details.truncation?.outputLines, DEFAULT_MAX_LINES);
		assert.equal(Object.hasOwn(details, "final_output"), false);

		const text = renderKillResultText(details);
		assert.match(text, /^\[killed\]/);
		assert.match(text, /requested_signal: SIGTERM/);
		assert.match(text, /Showing lines/);
		assert.match(text, /Full output: \/tmp\/full\.log/);
		assert.ok(Buffer.byteLength(text, "utf8") < DEFAULT_MAX_BYTES + 4096, `text bytes=${Buffer.byteLength(text)}`);
	});

	it("bounds model-visible metadata outside the output body", () => {
		const huge = `bad\x1b]52;c;payload\x07${"x".repeat(100_000)}`;
		const details = finalizeProcessResult({
			operation: "exec_command",
			wallTimeSec: 0,
			collected: encoder.encode("small output"),
			sessionId: undefined,
			exitCode: -1,
			signal: null,
			failure: huge,
			tty: false,
			cwd: huge,
		});
		const text = renderProcessResultText(details);

		assert.ok(Buffer.byteLength(text, "utf8") < 12_000, `text bytes=${Buffer.byteLength(text)}`);
		assert.doesNotMatch(text, /[\u001b\u009b]/);
		assert.match(text, /…/);
	});

	it("makes terminal control sequences inert before storing or rendering output", () => {
		const dangerous = "before\x1b]52;c;YXR0YWNrZXI=\x07after\x1b[?1049h";
		const details = finalizeProcessResult({
			operation: "write_stdin",
			wallTimeSec: 0.1,
			collected: encoder.encode(dangerous),
			sessionId: 5,
			exitCode: undefined,
			signal: null,
			failure: null,
			tty: true,
		});

		assert.equal(details.output, "beforeafter");
		assert.doesNotMatch(renderProcessResultText(details), /[\u001b\u009b]/);
	});

	it("represents a failed kill as a live, retained session", () => {
		const details = finalizeKillResult({
			wallTimeSec: 2.5,
			collected: encoder.encode("last diagnostic\n"),
			sessionId: 9,
			pid: 999,
			requestedSignal: "SIGTERM",
			exitCode: undefined,
			signal: null,
			failure: "process still running; session remains registered",
			tty: false,
			logPath: "/tmp/live.log",
			escalated: true,
			killed: false,
		});

		assert.equal(details.status, "kill_failed");
		assert.equal(details.running, true);
		assert.equal(details.killed, false);
		const text = renderKillResultText(details);
		assert.match(text, /^\[kill failed\]/);
		assert.match(text, /running: true/);
		assert.match(text, /session remains registered/);
	});
});
