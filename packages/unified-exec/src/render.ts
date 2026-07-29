/**
 * renderCall / renderResult for unified-exec tools.
 *
 * Styled after pi's built-in `bash` tool renderer (dist/core/tools/bash.js),
 * adapted for our session-oriented response shape:
 *   - renderCall: a `$ <cmd> (yield Ns · cwd: …)` header line
 *   - renderResult: output tail + live elapsed counter (while streaming) +
 *     status footer (session_id / exit_code / log_path / truncation) once
 *     a tool result has landed
 */

import {
	type AgentToolResult,
	DEFAULT_MAX_BYTES,
	formatSize,
	type Theme,
	type ToolDefinition,
	type ToolRenderResultOptions,
	truncateToVisualLines,
} from "@earendil-works/pi-coding-agent";
import { Container, Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { formatDurationSeconds, formatRemainingLater } from "./format-time.ts";

type ExportedRenderCall<TState> = NonNullable<ToolDefinition<any, any, TState>["renderCall"]>;
type ToolRenderContext<TState = any, TArgs = any> = Parameters<ExportedRenderCall<TState>>[2] & {
	args: TArgs;
	state: TState;
};

// Preview lines for collapsed display (matches pi bash).
const PREVIEW_LINES = 5;

/** State attached to a tool execution render across multiple re-renders. */
interface RenderState {
	startedAt?: number; // set when execution starts
	endedAt?: number; // set when the final result lands
	liveTicker?: NodeJS.Timeout; // 1s interval while streaming
	// Cached preview for the result body (invalidated on new chunks / expand toggle).
	cachedWidth?: number;
	cachedLines?: string[];
	cachedSkipped?: number;
}

/** Shape of details we expect on tool results (superset of what each call returns). */
interface DetailsShape {
	session_id?: number;
	exit_code?: number;
	signal?: string;
	failure_message?: string;
	log_path?: string;
	cwd?: string;
	command?: string;
	yield_time_ms?: number;
	yield_until?: string;
	wait_status?: string;
	completion_notification?: string;
	tty?: boolean;
	output?: string;
	running?: boolean;
	truncation?: {
		truncated: boolean;
		truncatedBy: "lines" | "bytes" | null;
		totalLines: number;
		outputLines: number;
		outputBytes: number;
		lastLinePartial: boolean;
		maxLines: number;
		maxBytes: number;
	};
}

/** Banner/footer label for an absolute wait: "2h40m later" (ISO kept in tool details). */
function formatUntilLabel(yieldUntil: string, nowMs: number = Date.now()): string {
	const targetMs = Date.parse(yieldUntil);
	if (!Number.isFinite(targetMs)) return `until ${yieldUntil}`;
	return formatRemainingLater(targetMs - nowMs);
}

/** Shorten `$HOME/foo/bar` → `~/foo/bar`; otherwise return as-is. */
function tildify(path: string): string {
	const home = process.env.HOME;
	if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;
	return path;
}

// ---------------- renderCall for exec_command ----------------

export function renderExecCommandCall(
	args: { cmd?: string; workdir?: string; tty?: boolean; yield_time_ms?: number },
	theme: Theme,
	context: ToolRenderContext<RenderState, typeof args>,
): Component {
	const state = context.state;
	if (context.executionStarted && state.startedAt === undefined) {
		state.startedAt = Date.now();
		state.endedAt = undefined;
	}

	// Passthrough: match pi's built-in `bash` renderer, which shows the command
	// verbatim (multi-line heredocs render across multiple rows).
	const cmd = args?.cmd || "...";
	const yieldMs = args?.yield_time_ms;
	const parts: string[] = [];
	if (yieldMs) parts.push(`yield ${(yieldMs / 1000).toFixed(1)}s`);
	const effectiveCwd = args?.workdir || context.cwd;
	if (effectiveCwd) parts.push(`cwd: ${tildify(effectiveCwd)}`);
	if (args?.tty) parts.push("tty");
	const suffix = parts.length ? theme.fg("muted", ` (${parts.join(" · ")})`) : "";
	const banner = theme.fg("toolTitle", theme.bold(`$ ${cmd}`)) + suffix;

	const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
	text.setText(banner);
	return text;
}

// ---------------- renderCall for set_on_exit ----------------

export function renderSetOnExitCall(
	args: { session_id?: number; on_exit?: string },
	theme: Theme,
	context: ToolRenderContext<RenderState, typeof args>,
): Component {
	const sid = args?.session_id !== undefined ? args.session_id : "?";
	const pol = args?.on_exit ?? "?";
	const banner =
		theme.fg("toolTitle", theme.bold("set_on_exit")) + theme.fg("muted", ` session_id=${sid} → ${pol}`);
	const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
	text.setText(banner);
	return text;
}

// ---------------- renderCall for write_stdin ----------------

export function renderWriteStdinCall(
	args: { session_id?: number; chars?: string; chars_b64?: string; yield_time_ms?: number; yield_until?: string },
	theme: Theme,
	context: ToolRenderContext<RenderState, typeof args>,
): Component {
	const state = context.state;
	if (context.executionStarted && state.startedAt === undefined) {
		state.startedAt = Date.now();
		state.endedAt = undefined;
	}

	const sid = args?.session_id !== undefined ? args.session_id : "?";
	const chars = args?.chars ?? "";
	const b64 = args?.chars_b64 ?? "";
	const isPoll = chars.length === 0 && b64.length === 0;
	const yieldMs = args?.yield_time_ms;
	const op = isPoll
		? theme.fg("muted", "⟳ poll")
		: chars.length > 0
			? theme.fg("toolTitle", theme.bold(`» ${stringifyChars(chars)}`))
			: theme.fg("toolTitle", theme.bold(`» (base64, ${base64ByteLength(b64)} bytes)`));
	const yieldSuffix = args?.yield_until
		? theme.fg("muted", ` (${formatUntilLabel(args.yield_until)})`)
		: yieldMs
			? theme.fg("muted", ` (yield ${(yieldMs / 1000).toFixed(1)}s)`)
			: "";
	const banner = `${op} ${theme.fg("muted", `→ session_id=${sid}`)}${yieldSuffix}`;

	const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
	text.setText(banner);
	return text;
}

/** Approximate decoded byte length of a base64 payload (for the banner). */
function base64ByteLength(b64: string): number {
	const compact = b64.replace(/\s+/g, "");
	const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
}

function stringifyChars(chars: string): string {
	// Escape control bytes so the banner shows something readable.
	const escaped = chars
		.replace(/\x03/g, "^C")
		.replace(/\x04/g, "^D")
		.replace(/\x1b/g, "^[")
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t");
	if (escaped.length > 40) return `${escaped.slice(0, 37)}…`;
	return escaped;
}

// ---------------- renderResult for both tools ----------------

/** A minimal Container-like wrapper so we can rebuild the result view per tick. */
class ResultContainer extends Container {
	state: RenderState = {};
}

export function renderResult(
	result: AgentToolResult<DetailsShape>,
	options: ToolRenderResultOptions,
	theme: Theme,
	context: ToolRenderContext<RenderState, any>,
): Component {
	const state = context.state;

	// Install a 1s ticker while streaming so the elapsed counter updates.
	if (state.startedAt !== undefined && options.isPartial && !state.liveTicker) {
		state.liveTicker = setInterval(() => context.invalidate(), 1000);
	}
	if (!options.isPartial || context.isError) {
		state.endedAt ??= Date.now();
		if (state.liveTicker) {
			clearInterval(state.liveTicker);
			state.liveTicker = undefined;
		}
	}

	const container =
		context.lastComponent instanceof ResultContainer ? context.lastComponent : new ResultContainer();
	container.state = state;
	container.clear();

	rebuildResultBody(container, result, options, theme, state);
	container.invalidate();
	return container;
}

function rebuildResultBody(
	container: ResultContainer,
	result: AgentToolResult<DetailsShape>,
	options: ToolRenderResultOptions,
	theme: Theme,
	state: RenderState,
): void {
	const details = result.details ?? {};
	// Prefer the structured `details.output` (clean body). Fall back to the
	// result's content text (which during streaming is the raw tail, and after
	// completion is the structured text — in that case we'd rather show the
	// body, but details.output is always populated, so this fallback is rare).
	const body = details.output ?? getContentText(result);

	if (body) {
		const styled = body
			.split("\n")
			.map((line) => theme.fg("toolOutput", line))
			.join("\n");
		if (options.expanded) {
			container.addChild(new Text(`\n${styled}`, 0, 0));
		} else {
			container.addChild({
				render: (width: number): string[] => {
					if (state.cachedLines === undefined || state.cachedWidth !== width) {
						const preview = truncateToVisualLines(styled, PREVIEW_LINES, width);
						state.cachedLines = preview.visualLines;
						state.cachedSkipped = preview.skippedCount;
						state.cachedWidth = width;
					}
					if (state.cachedSkipped && state.cachedSkipped > 0) {
						const hint = theme.fg("muted", `… ${state.cachedSkipped} earlier lines`);
						return ["", truncateToWidth(hint, width, "..."), ...(state.cachedLines ?? [])];
					}
					return ["", ...(state.cachedLines ?? [])];
				},
				invalidate: () => {
					state.cachedWidth = undefined;
					state.cachedLines = undefined;
					state.cachedSkipped = undefined;
				},
			});
		}
	}

	// Truncation warning (matches pi bash's yellow warning style).
	const t = details.truncation;
	if (t?.truncated) {
		const logInfo = details.log_path ? `. Full output: ${details.log_path}` : "";
		let msg: string;
		if (t.lastLinePartial) {
			msg = `Truncated: last ${formatSize(t.outputBytes)} of line ${t.totalLines} shown (${formatSize(DEFAULT_MAX_BYTES)} limit)${logInfo}`;
		} else if (t.truncatedBy === "lines") {
			msg = `Truncated: showing ${t.outputLines} of ${t.totalLines} lines${logInfo}`;
		} else {
			msg = `Truncated: ${t.outputLines} lines shown (${formatSize(DEFAULT_MAX_BYTES)} limit)${logInfo}`;
		}
		container.addChild(new Text(`\n${theme.fg("warning", `[${msg}]`)}`, 0, 0));
	}

	// Status footer: elapsed + session/exit + log path.
	container.addChild(new Text(`\n${buildStatusLine(details, options, theme, state)}`, 0, 0));
}

function buildStatusLine(
	d: DetailsShape,
	options: ToolRenderResultOptions,
	theme: Theme,
	state: RenderState,
): string {
	const bits: string[] = [];

	// Timing label:
	//   - streaming ........................ "elapsed"   (updates every 1s)
	//   - done, session still alive ........ "yielded"  (hit yield deadline)
	//   - done, session exited ............. "took"     (process finished)
	if (state.startedAt !== undefined) {
		const now = state.endedAt ?? Date.now();
		const dur = formatDurationSeconds(now - state.startedAt);
		let label: string;
		if (options.isPartial) label = "elapsed";
		else if (d.session_id !== undefined) label = "yielded";
		else label = "took";
		bits.push(`${label} ${dur}`);
	}

	// Session identity: session_id if still running, exit_code otherwise.
	if (d.session_id !== undefined) {
		bits.push(`session_id=${d.session_id}`);
	} else if (d.exit_code !== undefined) {
		const codeLabel = d.exit_code === 0 ? `exit_code=${d.exit_code}` : theme.fg("error", `exit_code=${d.exit_code}`);
		bits.push(codeLabel);
	} else if (d.signal) {
		bits.push(theme.fg("error", `signal=${d.signal}`));
	}
	if (d.failure_message) {
		bits.push(theme.fg("error", `failure: ${d.failure_message}`));
	}

	// Long-wait / wake state: human remaining countdown while attached to an
	// absolute deadline, whether the wait was cancelled, and whether a
	// completion notification is still armed. The 1s liveTicker keeps the
	// "2h40m later" label fresh while options.isPartial.
	if (d.yield_until && (options.isPartial || d.session_id !== undefined)) {
		bits.push(formatUntilLabel(d.yield_until));
	}
	if (d.wait_status === "cancelled") {
		bits.push(theme.fg("warning", "cancelled"));
	}
	if (d.completion_notification === "armed") {
		bits.push("wake armed");
	}

	// Log file path (shortened).
	if (d.log_path) {
		bits.push(`log: ${tildify(d.log_path)}`);
	}

	return theme.fg("muted", bits.join(" · "));
}

function getContentText(result: AgentToolResult<unknown>): string {
	const first = result.content[0];
	if (first && first.type === "text") return first.text;
	return "";
}
