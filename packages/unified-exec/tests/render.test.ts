import { strict as assert } from "node:assert";
import { before, describe, it } from "node:test";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";

import {
	renderKillSessionCall,
	renderKillSessionResult,
	renderListSessionsResult,
	renderProcessResult,
} from "../src/render.ts";
import {
	finalizeKillResult,
	finalizeProcessResult,
	renderKillResultText,
	renderProcessResultText,
} from "../src/tool-result.ts";

const encoder = new TextEncoder();
const plainTheme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as Theme;

function rendered(component: { render(width: number): string[] }, width = 100): string {
	return component
		.render(width)
		.map((line) => line.trimEnd())
		.join("\n");
}

function context(state: Record<string, unknown>, lastComponent?: unknown): any {
	return {
		args: {},
		state,
		lastComponent,
		cwd: "/repo",
		toolCallId: "test",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError: false,
		invalidate: () => {},
	};
}

before(() => {
	initTheme("dark", false);
});

describe("unified-exec renderers", () => {
	it("kill_session is collapsed to five visual output lines and expands on demand", () => {
		const output = Array.from({ length: 20 }, (_, index) => `line-${index + 1}`).join("\n");
		const details = finalizeKillResult({
			wallTimeSec: 0.1,
			collected: encoder.encode(output),
			totalBytes: Buffer.byteLength(output),
			sessionId: 73,
			pid: 777,
			requestedSignal: "SIGTERM",
			exitCode: undefined,
			signal: "SIGTERM",
			failure: null,
			tty: false,
			logPath: "/tmp/kill.log",
			cwd: "/repo",
			command: "noisy job",
			escalated: false,
			killed: true,
		});
		const result = { content: [{ type: "text", text: renderKillResultText(details) }], details } as any;
		const state: Record<string, unknown> = {};

		renderKillSessionCall({ session_id: 73 }, plainTheme, context(state));
		const collapsed = renderKillSessionResult(result, { expanded: false, isPartial: false }, plainTheme, context(state));
		const collapsedText = rendered(collapsed);
		assert.match(collapsedText, /line-16/);
		assert.match(collapsedText, /line-20/);
		assert.doesNotMatch(collapsedText, /\nline-1\n/);
		assert.match(collapsedText, /earlier lines/);
		assert.match(collapsedText.toLowerCase(), /to expand/);
		assert.match(collapsedText, /killed session_id=73/);

		const expanded = renderKillSessionResult(
			result,
			{ expanded: true, isPartial: false },
			plainTheme,
			context(state, collapsed),
		);
		const expandedText = rendered(expanded);
		assert.match(expandedText, /line-1\n/);
		assert.match(expandedText, /line-20/);
		assert.doesNotMatch(expandedText, /earlier lines/);

		const recollapsed = renderKillSessionResult(
			result,
			{ expanded: false, isPartial: false },
			plainTheme,
			context(state, expanded),
		);
		const recollapsedText = rendered(recollapsed);
		assert.match(recollapsedText, /earlier lines/);
		assert.doesNotMatch(recollapsedText, /\nline-1\n/);
	});

	it("defensively strips terminal-control sequences from calls and legacy details", () => {
		const osc = "\x1b]52;c;YXR0YWNrZXI=\x07";
		const state: Record<string, unknown> = {};
		const call = renderKillSessionCall({ session_id: 4, signal: `SIGTERM${osc}` }, plainTheme, context(state));
		assert.doesNotMatch(rendered(call), /[\u001b\u009b]/);

		const details = {
			operation: "kill_session",
			status: "killed",
			running: false,
			found: true,
			session_id: 4,
			requested_signal: "SIGTERM",
			killed: true,
			escalated: false,
			chunk_id: "abc123",
			wall_time_seconds: 0.1,
			output: `before${osc}after`,
		};
		const result = { content: [{ type: "text", text: "fallback" }], details } as any;
		const component = renderKillSessionResult(
			result,
			{ expanded: true, isPartial: false },
			plainTheme,
			context(state),
		);
		const text = rendered(component);
		assert.match(text, /beforeafter/);
		assert.doesNotMatch(text, /[\u001b\u009b]/);
	});

	it("refreshes a cached collapsed preview when partial output grows", () => {
		const state: Record<string, unknown> = {};
		const firstDetails = finalizeProcessResult({
			operation: "write_stdin",
			wallTimeSec: 0.1,
			collected: encoder.encode(Array.from({ length: 8 }, (_, index) => `old-${index + 1}`).join("\n")),
			sessionId: 3,
			exitCode: undefined,
			signal: null,
			failure: null,
			tty: false,
		});
		const firstResult = {
			content: [{ type: "text", text: renderProcessResultText(firstDetails) }],
			details: firstDetails,
		} as any;
		const first = renderProcessResult(firstResult, { expanded: false, isPartial: true }, plainTheme, context(state));
		assert.match(rendered(first), /old-8/);

		const nextDetails = finalizeProcessResult({
			operation: "write_stdin",
			wallTimeSec: 0.2,
			collected: encoder.encode(Array.from({ length: 8 }, (_, index) => `new-${index + 1}`).join("\n")),
			sessionId: 3,
			exitCode: undefined,
			signal: null,
			failure: null,
			tty: false,
		});
		const nextResult = {
			content: [{ type: "text", text: renderProcessResultText(nextDetails) }],
			details: nextDetails,
		} as any;
		const next = renderProcessResult(
			nextResult,
			{ expanded: false, isPartial: false },
			plainTheme,
			context(state, first),
		);
		const nextText = rendered(next);
		assert.match(nextText, /new-8/);
		assert.doesNotMatch(nextText, /old-8/);
	});

	it("kill_session unknown-id results are compact errors", () => {
		const component = renderKillSessionResult(
			{
				content: [{ type: "text", text: "No such session: 999" }],
				details: { operation: "kill_session", status: "kill_failed", running: false, found: false },
			} as any,
			{ expanded: false, isPartial: false },
			plainTheme,
			context({}),
		);
		assert.equal(rendered(component, 80).trim(), "No such session: 999");
	});

	it("list_sessions previews five entries, caches rows, and expands all entries with log paths", () => {
		const sessions = Array.from({ length: 7 }, (_, index) => ({
			session_id: index + 1,
			command: `sleep ${index + 1}`,
			cwd: "/repo",
			tty: false,
			pid: 1000 + index,
			elapsed_ms: 1000 * (index + 1),
			running: true,
			wake_armed: index === 0,
			output_bytes_total: index,
			log_path: `/tmp/session-${index + 1}.log`,
		}));
		let firstCommandReads = 0;
		Object.defineProperty(sessions[0], "command", {
			get: () => {
				firstCommandReads++;
				return "sleep 1";
			},
		});
		const result = {
			content: [{ type: "text", text: "fallback should not render" }],
			details: { sessions, active_count: 7, just_exited_count: 0, tool_time_utc: "2026-08-04T00:00:00.000Z" },
		} as any;

		const collapsed = renderListSessionsResult(result, { expanded: false, isPartial: false }, plainTheme, context({}));
		const collapsedText = rendered(collapsed);
		assert.match(collapsedText, /#1 /);
		assert.match(collapsedText, /#5 /);
		assert.doesNotMatch(collapsedText, /#6 /);
		assert.match(collapsedText, /2 more sessions/);
		assert.match(collapsedText.toLowerCase(), /to expand/);
		rendered(collapsed);
		assert.equal(firstCommandReads, 1, "same-width redraw should reuse cached rows");

		const expanded = renderListSessionsResult(
			result,
			{ expanded: true, isPartial: false },
			plainTheme,
			context({}, collapsed),
		);
		const expandedText = rendered(expanded);
		assert.match(expandedText, /#7 /);
		assert.match(expandedText, /log: \/tmp\/session-7\.log/);
		assert.doesNotMatch(expandedText, /more sessions/);
	});
});
