/**
 * Custom TUI renderers for every unified-exec tool.
 *
 * Child output has three independent layers:
 *   1. the complete session log on disk;
 *   2. the bounded result payload in details.output;
 *   3. a five-visual-line collapsed TUI preview of that bounded payload.
 *
 * Renderers are display-only. The model-visible content is already bounded in
 * tool-result.ts, so a renderer failure cannot expose the retained 1 MiB buffer
 * through Pi's generic fallback renderer.
 */

import {
	type AgentToolResult,
	DEFAULT_MAX_BYTES,
	formatSize,
	keyHint,
	type Theme,
	type ToolDefinition,
	type ToolRenderResultOptions,
	truncateToVisualLines,
} from "@earendil-works/pi-coding-agent";
import { Container, Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";

import { formatDurationSeconds, formatRemainingLater } from "./format-time.ts";
import { sanitizeOutputText } from "./output-safety.ts";
import type { KillResultDetails, OutputResultDetails, ProcessResultDetails } from "./tool-result.ts";

type ExportedRenderCall<TState> = NonNullable<ToolDefinition<any, any, TState>["renderCall"]>;
type ToolRenderContext<TState = any, TArgs = any> = Parameters<ExportedRenderCall<TState>>[2] & {
	args: TArgs;
	state: TState;
};

// Preview lines for collapsed output (matches Pi's built-in bash tool).
const PREVIEW_LINES = 5;
const LIST_PREVIEW_SESSIONS = 5;

/** State attached to one tool execution across call/result re-renders. */
interface RenderState {
	startedAt?: number;
	endedAt?: number;
	liveTicker?: NodeJS.Timeout;
	cachedBody?: string;
	cachedWidth?: number;
	cachedLines?: string[];
	cachedSkipped?: number;
}

/** Superset of process/kill details plus partial-stream and compatibility fields. */
interface DetailsShape extends Partial<OutputResultDetails> {
	operation?: ProcessResultDetails["operation"] | KillResultDetails["operation"];
	status?: ProcessResultDetails["status"] | KillResultDetails["status"];
	found?: boolean;
	pid?: number;
	requested_signal?: string;
	killed?: boolean;
	escalated?: boolean;
	yield_time_ms?: number;
	yield_until?: string;
	wait_status?: string;
	completion_notification?: string;
	wake_armed?: boolean;
}

interface SessionListItem {
	session_id: number;
	command: string;
	cwd: string;
	tty: boolean;
	pid?: number;
	elapsed_ms: number;
	running: boolean;
	wake_armed: boolean;
	exit_code?: number | null;
	signal?: string;
	failure_message?: string;
	output_bytes_total: number;
	log_path: string;
}

interface ListSessionsDetails {
	sessions?: SessionListItem[];
	active_count?: number;
	just_exited_count?: number;
	tool_time_utc?: string;
}

function markStarted(state: RenderState, executionStarted: boolean): void {
	if (executionStarted && state.startedAt === undefined) {
		state.startedAt = Date.now();
		state.endedAt = undefined;
	}
}

/** `until <ISO> · 2h40m later`; unparseable timestamps show only the raw value. */
function formatUntilLabel(yieldUntil: string, nowMs: number = Date.now()): string {
	const safeYieldUntil = safeOneLine(yieldUntil);
	const targetMs = Date.parse(safeYieldUntil);
	if (!Number.isFinite(targetMs)) return `until ${safeYieldUntil}`;
	return `until ${safeYieldUntil} · ${formatRemainingLater(targetMs - nowMs)}`;
}

/** Shorten `$HOME/foo/bar` → `~/foo/bar`; otherwise return as-is. */
function tildify(path: string): string {
	const home = process.env.HOME;
	if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;
	return path;
}

function safeOneLine(value: string, max = 120): string {
	// Only a short preview is displayed. Bound the scan itself so a megabyte
	// heredoc command cannot stall one TUI frame merely to produce 100 cells.
	const scanLimit = Math.max(512, max * 8);
	let end = Math.min(value.length, scanLimit);
	if (end < value.length && end > 0 && /[\ud800-\udbff]/.test(value[end - 1]!)) end--;
	const clipped = end < value.length;
	const clean = sanitizeOutputText(value.slice(0, end)).replace(/\s+/g, " ").trim();
	if (!clipped && clean.length <= max) return clean;
	if (max <= 0) return "";
	if (max === 1) return "…";
	return `${clean.slice(0, max - 1)}…`;
}

// ---------------- renderCall ----------------

export function renderExecCommandCall(
	args: { cmd?: string; workdir?: string; tty?: boolean; yield_time_ms?: number; on_exit?: unknown },
	theme: Theme,
	context: ToolRenderContext<RenderState, typeof args>,
): Component {
	const state = context.state;
	markStarted(state, context.executionStarted);

	// Match Pi's built-in bash renderer: preserve multiline commands verbatim.
	const cmd = sanitizeOutputText(args?.cmd || "...");
	const parts: string[] = [];
	if (args?.yield_time_ms) parts.push(`yield ${(args.yield_time_ms / 1000).toFixed(1)}s`);
	const effectiveCwd = args?.workdir || context.cwd;
	if (effectiveCwd) parts.push(`cwd: ${safeOneLine(tildify(effectiveCwd))}`);
	if (args?.tty) parts.push("tty");
	const suffix = parts.length ? theme.fg("muted", ` (${parts.join(" · ")})`) : "";
	const wake = args?.on_exit === "wake" ? theme.fg("warning", " [wake]") : "";
	const banner = theme.fg("toolTitle", theme.bold(`$ ${cmd}`)) + suffix + wake;

	const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
	text.setText(banner);
	return text;
}

export function renderWriteStdinCall(
	args: { session_id?: number; chars?: string; chars_b64?: string; yield_time_ms?: number; yield_until?: string },
	theme: Theme,
	context: ToolRenderContext<RenderState, typeof args>,
): Component {
	const state = context.state;
	markStarted(state, context.executionStarted);

	const sid = args?.session_id !== undefined ? args.session_id : "?";
	const chars = args?.chars ?? "";
	const b64 = args?.chars_b64 ?? "";
	const isPoll = chars.length === 0 && b64.length === 0;
	const op = isPoll
		? theme.fg("muted", "⟳ poll")
		: chars.length > 0
			? theme.fg("toolTitle", theme.bold(`» ${stringifyChars(chars)}`))
			: theme.fg("toolTitle", theme.bold(`» (base64, ${base64ByteLength(b64)} bytes)`));
	const yieldSuffix = args?.yield_until
		? theme.fg("muted", ` (${formatUntilLabel(args.yield_until)})`)
		: args?.yield_time_ms
			? theme.fg("muted", ` (yield ${(args.yield_time_ms / 1000).toFixed(1)}s)`)
			: "";
	const banner = `${op} ${theme.fg("muted", `→ session_id=${sid}`)}${yieldSuffix}`;

	const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
	text.setText(banner);
	return text;
}

export function renderSetOnExitCall(
	args: { session_id?: number; on_exit?: unknown },
	theme: Theme,
	context: ToolRenderContext<RenderState, typeof args>,
): Component {
	const sid = args?.session_id !== undefined ? args.session_id : "?";
	const policy = typeof args?.on_exit === "string" ? safeOneLine(args.on_exit) : "?";
	const banner =
		theme.fg("toolTitle", theme.bold("set_on_exit")) + theme.fg("muted", ` session_id=${sid} → ${policy}`);
	const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
	text.setText(banner);
	return text;
}

export function renderKillSessionCall(
	args: { session_id?: number; signal?: string },
	theme: Theme,
	context: ToolRenderContext<RenderState, typeof args>,
): Component {
	const state = context.state;
	markStarted(state, context.executionStarted);
	const sid = args?.session_id !== undefined ? args.session_id : "?";
	const signal = typeof args?.signal === "string" ? safeOneLine(args.signal) || "SIGTERM" : "SIGTERM";
	const banner =
		theme.fg("toolTitle", theme.bold("kill_session")) +
		theme.fg("muted", ` session_id=${sid} signal=${signal}`);
	const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
	text.setText(banner);
	return text;
}

export function renderListSessionsCall(
	_args: object,
	theme: Theme,
	context: ToolRenderContext<RenderState, object>,
): Component {
	const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
	text.setText(theme.fg("toolTitle", theme.bold("list_sessions")));
	return text;
}

function base64ByteLength(b64: string): number {
	const compact = b64.replace(/\s+/g, "");
	const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
}

function stringifyChars(chars: string): string {
	const escaped = chars
		.replace(/\x03/g, "^C")
		.replace(/\x04/g, "^D")
		.replace(/\x1b/g, "^[")
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t");
	const safe = sanitizeOutputText(escaped);
	return safe.length > 40 ? `${safe.slice(0, 37)}…` : safe;
}

// ---------------- output-bearing results ----------------

class OutputResultContainer extends Container {
	state: RenderState = {};
}

function renderOutputResult(
	result: AgentToolResult<DetailsShape>,
	options: ToolRenderResultOptions,
	theme: Theme,
	context: ToolRenderContext<RenderState, any>,
): Component {
	const state = context.state;

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
		context.lastComponent instanceof OutputResultContainer ? context.lastComponent : new OutputResultContainer();
	container.state = state;
	container.clear();
	rebuildOutputResult(container, result, options, theme, state);
	container.invalidate();
	return container;
}

export function renderProcessResult(
	result: AgentToolResult<DetailsShape>,
	options: ToolRenderResultOptions,
	theme: Theme,
	context: ToolRenderContext<RenderState, any>,
): Component {
	return renderOutputResult(result, options, theme, context);
}

export function renderKillSessionResult(
	result: AgentToolResult<DetailsShape>,
	options: ToolRenderResultOptions,
	theme: Theme,
	context: ToolRenderContext<RenderState, any>,
): Component {
	if (result.details?.found === false) {
		const message = sanitizeOutputText(getContentText(result)) || "No such session";
		return new Text(`\n${theme.fg("error", message)}`, 0, 0);
	}
	return renderOutputResult(result, options, theme, context);
}

function rebuildOutputResult(
	container: OutputResultContainer,
	result: AgentToolResult<DetailsShape>,
	options: ToolRenderResultOptions,
	theme: Theme,
	state: RenderState,
): void {
	const details = result.details ?? {};
	const body = sanitizeOutputText(details.output ?? getContentText(result));
	// Partial updates reuse the same context state and component. Width alone
	// is not a sufficient cache key: invalidate the preview when output grows.
	if (state.cachedBody !== body) {
		state.cachedBody = body;
		state.cachedWidth = undefined;
		state.cachedLines = undefined;
		state.cachedSkipped = undefined;
	}

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
						const hint =
							theme.fg("muted", `... (${state.cachedSkipped} earlier lines,`) +
							` ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
						return ["", truncateToWidth(hint, width, "..."), ...(state.cachedLines ?? [])];
					}
					return ["", ...(state.cachedLines ?? [])];
				},
				invalidate: () => {
					state.cachedBody = undefined;
					state.cachedWidth = undefined;
					state.cachedLines = undefined;
					state.cachedSkipped = undefined;
				},
			});
		}
	}

	const t = details.truncation;
	if (t?.truncated) {
		const logInfo = details.log_path ? `. Full output: ${safeOneLine(details.log_path)}` : "";
		let message: string;
		if (t.lastLinePartial) {
			message = `Truncated: last ${formatSize(t.outputBytes)} of line ${t.totalLines} shown (${formatSize(DEFAULT_MAX_BYTES)} limit)${logInfo}`;
		} else if (t.truncatedBy === "lines") {
			message = `Truncated: showing ${t.outputLines} of ${t.totalLines} lines${logInfo}`;
		} else {
			message = `Truncated: ${t.outputLines} lines shown (${formatSize(DEFAULT_MAX_BYTES)} limit)${logInfo}`;
		}
		container.addChild(new Text(`\n${theme.fg("warning", `[${message}]`)}`, 0, 0));
	}

	const status = buildStatusLine(details, options, theme, state);
	if (status) container.addChild(new Text(`\n${status}`, 0, 0));
}

function buildStatusLine(
	details: DetailsShape,
	options: ToolRenderResultOptions,
	theme: Theme,
	state: RenderState,
): string {
	const bits: string[] = [];

	if (state.startedAt !== undefined) {
		const now = state.endedAt ?? Date.now();
		const duration = formatDurationSeconds(now - state.startedAt);
		const label = options.isPartial ? "elapsed" : details.running ? "yielded" : "took";
		bits.push(`${label} ${duration}`);
	}

	if (details.operation === "kill_session") {
		bits.push(
			details.killed
				? theme.fg("success", `killed session_id=${details.session_id ?? "?"}`)
				: theme.fg("error", `FAILED session_id=${details.session_id ?? "?"} · still running`),
		);
		if (details.pid !== undefined) bits.push(`pid=${details.pid}`);
		if (details.requested_signal) bits.push(`requested=${safeOneLine(details.requested_signal)}`);
		if (details.escalated) bits.push(theme.fg("warning", "escalated to SIGKILL"));
		if (details.exit_code !== undefined) bits.push(`exit_code=${details.exit_code}`);
		else if (details.signal) bits.push(`signal=${safeOneLine(details.signal)}`);
	} else {
		if (details.running && details.session_id !== undefined) {
			bits.push(`session_id=${details.session_id}`);
		} else if (details.exit_code !== undefined) {
			bits.push(
				details.exit_code === 0
					? `exit_code=${details.exit_code}`
					: theme.fg("error", `exit_code=${details.exit_code}`),
			);
		} else if (details.signal) {
			bits.push(theme.fg("error", `signal=${safeOneLine(details.signal)}`));
		}
	}

	if (details.failure_message) bits.push(theme.fg("error", `failure: ${safeOneLine(details.failure_message)}`));
	if (details.yield_until && (options.isPartial || details.running)) {
		bits.push(formatUntilLabel(details.yield_until));
	}
	if (details.wait_status === "cancelled") bits.push(theme.fg("warning", "cancelled"));
	if (details.completion_notification === "armed") bits.push("wake armed");
	if (details.log_path) bits.push(`log: ${safeOneLine(tildify(details.log_path))}`);

	return theme.fg("muted", bits.join(" · "));
}

// ---------------- small structured results ----------------

export function renderSetOnExitResult(
	result: AgentToolResult<Record<string, unknown>>,
	_options: ToolRenderResultOptions,
	theme: Theme,
	_context: ToolRenderContext<RenderState, any>,
): Component {
	const found = result.details?.found;
	const message = sanitizeOutputText(getContentText(result));
	const color = found === false ? "error" : "muted";
	return new Text(message ? `\n${theme.fg(color, message)}` : "", 0, 0);
}

class ListResultContainer extends Container {}

export function renderListSessionsResult(
	result: AgentToolResult<ListSessionsDetails>,
	options: ToolRenderResultOptions,
	theme: Theme,
	context: ToolRenderContext<RenderState, any>,
): Component {
	const details = result.details;
	if (!details?.sessions) {
		const fallback = sanitizeOutputText(getContentText(result));
		return new Text(fallback ? `\n${theme.fg("toolOutput", fallback)}` : "", 0, 0);
	}

	const container = context.lastComponent instanceof ListResultContainer ? context.lastComponent : new ListResultContainer();
	container.clear();
	const sessions = details.sessions;
	const active = details.active_count ?? sessions.filter((session) => session.running).length;
	const justExited = details.just_exited_count ?? sessions.filter((session) => !session.running).length;
	const summary = `${active} live${justExited ? ` · ${justExited} just exited` : ""}`;
	container.addChild(new Text(`\n${theme.fg("muted", summary)}`, 0, 0));

	if (sessions.length === 0) {
		container.addChild(new Text(`\n${theme.fg("muted", "(no live sessions)")}`, 0, 0));
	} else {
		// A settled transcript row is rendered on every host redraw (including
		// unrelated streaming and typing). Cache its bounded inventory by width
		// so long command strings are sanitized and wrapped only when needed.
		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;
		container.addChild({
			render: (width: number): string[] => {
				if (cachedLines && cachedWidth === width) return cachedLines;
				const shown = options.expanded ? sessions : sessions.slice(0, LIST_PREVIEW_SESSIONS);
				const lines: string[] = [""];
				for (const session of shown) {
					const state = session.running
						? theme.fg("success", "running")
						: theme.fg(
								"muted",
								session.exit_code !== undefined
									? `exited=${session.exit_code}`
									: `signal=${safeOneLine(session.signal ?? "?")}`,
							);
					const wake = session.wake_armed ? theme.fg("warning", " [wake]") : "";
					const command = safeOneLine(session.command, 100);
					const line = `#${session.session_id} pid=${session.pid ?? "?"} ${session.tty ? "tty" : "pipe"} ${(session.elapsed_ms / 1000).toFixed(1)}s ${state}${wake} ${command}`;
					lines.push(truncateToWidth(line, width, "..."));
					if (options.expanded) {
						lines.push(
							truncateToWidth(theme.fg("muted", `  log: ${safeOneLine(tildify(session.log_path))}`), width, "..."),
						);
					}
				}
				if (!options.expanded && sessions.length > shown.length) {
					const hidden = sessions.length - shown.length;
					const hint =
						theme.fg("muted", `... (${hidden} more sessions,`) +
						` ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
					lines.push(truncateToWidth(hint, width, "..."));
				}
				cachedWidth = width;
				cachedLines = lines;
				return lines;
			},
			invalidate: () => {
				cachedWidth = undefined;
				cachedLines = undefined;
			},
		});
	}
	if (details.tool_time_utc) {
		container.addChild(new Text(`\n${theme.fg("muted", `tool_time_utc: ${safeOneLine(details.tool_time_utc)}`)}`, 0, 0));
	}
	container.invalidate();
	return container;
}

function getContentText(result: AgentToolResult<unknown>): string {
	return result.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}
