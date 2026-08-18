import { strict as assert } from "node:assert";

import { beforeAll, describe, it } from "vitest";
import {
  type AgentToolResult,
  initTheme,
  Theme,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

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
import type {
  RenderState,
  SessionListing,
  UnifiedExecDetails,
  UnifiedRenderContext,
} from "../src/tool-types.ts";

const encoder = new TextEncoder();

const noForegrounds: Record<ThemeColor, string> = {
  accent: "#888888",
  border: "#888888",
  borderAccent: "#888888",
  borderMuted: "#888888",
  success: "#888888",
  error: "#888888",
  warning: "#888888",
  muted: "#888888",
  dim: "#888888",
  text: "#888888",
  searchMatchText: "#888888",
  thinkingText: "#888888",
  userMessageText: "#888888",
  customMessageText: "#888888",
  customMessageLabel: "#888888",
  toolTitle: "#888888",
  toolOutput: "#888888",
  mdHeading: "#888888",
  mdLink: "#888888",
  mdLinkUrl: "#888888",
  mdCode: "#888888",
  mdCodeBlock: "#888888",
  mdCodeBlockBorder: "#888888",
  mdQuote: "#888888",
  mdQuoteBorder: "#888888",
  mdHr: "#888888",
  mdListBullet: "#888888",
  toolDiffAdded: "#888888",
  toolDiffRemoved: "#888888",
  toolDiffContext: "#888888",
  syntaxComment: "#888888",
  syntaxKeyword: "#888888",
  syntaxFunction: "#888888",
  syntaxVariable: "#888888",
  syntaxString: "#888888",
  syntaxNumber: "#888888",
  syntaxType: "#888888",
  syntaxOperator: "#888888",
  syntaxPunctuation: "#888888",
  thinkingOff: "#888888",
  thinkingMinimal: "#888888",
  thinkingLow: "#888888",
  thinkingMedium: "#888888",
  thinkingHigh: "#888888",
  thinkingXhigh: "#888888",
  thinkingMax: "#888888",
  bashMode: "#888888",
};

const noBackgrounds: ConstructorParameters<typeof Theme>[1] = {
  selectedBg: "#000000",
  userMessageBg: "#000000",
  customMessageBg: "#000000",
  toolPendingBg: "#000000",
  toolSuccessBg: "#000000",
  toolErrorBg: "#000000",
};

/** Identity styling: color/format functions return the text unchanged. */
class PlainTheme extends Theme {
  constructor() {
    super(noForegrounds, noBackgrounds, "truecolor");
  }
  override fg(_color: ThemeColor, text: string): string {
    return text;
  }
  override bold(text: string): string {
    return text;
  }
}

const plainTheme = new PlainTheme();

function rendered(component: { render(width: number): string[] }, width = 100): string {
  return component
    .render(width)
    .map((line) => line.trimEnd())
    .join("\n");
}

function makeContext<TArgs>(
  args: TArgs,
  state: RenderState,
  lastComponent?: Component,
): UnifiedRenderContext<TArgs> {
  return {
    args,
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
    invalidate: () => undefined,
  };
}

function makeResult(
  details: UnifiedExecDetails,
  text?: string,
): AgentToolResult<UnifiedExecDetails> {
  return { content: [{ type: "text", text: text ?? details.output ?? "" }], details };
}

beforeAll(() => {
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
    const result = makeResult(details, renderKillResultText(details));
    const state: RenderState = {};

    renderKillSessionCall({ session_id: 73 }, plainTheme, makeContext({ session_id: 73 }, state));
    const collapsed = renderKillSessionResult(
      result,
      { expanded: false, isPartial: false },
      plainTheme,
      makeContext({ session_id: 73 }, state),
    );
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
      makeContext({ session_id: 73 }, state, collapsed),
    );
    const expandedText = rendered(expanded);
    assert.match(expandedText, /line-1\n/);
    assert.match(expandedText, /line-20/);
    assert.doesNotMatch(expandedText, /earlier lines/);

    const recollapsed = renderKillSessionResult(
      result,
      { expanded: false, isPartial: false },
      plainTheme,
      makeContext({ session_id: 73 }, state, expanded),
    );
    const recollapsedText = rendered(recollapsed);
    assert.match(recollapsedText, /earlier lines/);
    assert.doesNotMatch(recollapsedText, /\nline-1\n/);
  });

  it("defensively strips terminal-control sequences from calls and legacy details", () => {
    const osc = "\x1b]52;c;YXR0YWNrZXI=\x07";
    const state: RenderState = {};
    const call = renderKillSessionCall(
      { session_id: 4, signal: `SIGTERM${osc}` },
      plainTheme,
      makeContext({ session_id: 4, signal: `SIGTERM${osc}` }, state),
    );
    assert.doesNotMatch(rendered(call), /[\u001b\u009b]/);

    const details: UnifiedExecDetails = {
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
    const component = renderKillSessionResult(
      makeResult(details),
      { expanded: true, isPartial: false },
      plainTheme,
      makeContext({ session_id: 4 }, state),
    );
    const text = rendered(component);
    assert.match(text, /beforeafter/);
    assert.doesNotMatch(text, /[\u001b\u009b]/);
  });

  it("refreshes a cached collapsed preview when partial output grows", () => {
    const state: RenderState = {};
    const firstDetails = finalizeProcessResult({
      operation: "write_stdin",
      wallTimeSec: 0.1,
      collected: encoder.encode(
        Array.from({ length: 8 }, (_, index) => `old-${index + 1}`).join("\n"),
      ),
      sessionId: 3,
      exitCode: undefined,
      signal: null,
      failure: null,
      tty: false,
    });
    const firstResult = makeResult(firstDetails, renderProcessResultText(firstDetails));
    const first = renderProcessResult(
      firstResult,
      { expanded: false, isPartial: true },
      plainTheme,
      makeContext({}, state),
    );
    assert.match(rendered(first), /old-8/);

    const nextDetails = finalizeProcessResult({
      operation: "write_stdin",
      wallTimeSec: 0.2,
      collected: encoder.encode(
        Array.from({ length: 8 }, (_, index) => `new-${index + 1}`).join("\n"),
      ),
      sessionId: 3,
      exitCode: undefined,
      signal: null,
      failure: null,
      tty: false,
    });
    const nextResult = makeResult(nextDetails, renderProcessResultText(nextDetails));
    const next = renderProcessResult(
      nextResult,
      { expanded: false, isPartial: false },
      plainTheme,
      makeContext({}, state, first),
    );
    const nextText = rendered(next);
    assert.match(nextText, /new-8/);
    assert.doesNotMatch(nextText, /old-8/);
  });

  it("kill_session unknown-id results are compact errors", () => {
    const component = renderKillSessionResult(
      makeResult(
        {
          operation: "kill_session",
          status: "kill_failed",
          running: false,
          found: false,
        },
        "No such session: 999",
      ),
      { expanded: false, isPartial: false },
      plainTheme,
      makeContext({}, {}),
    );
    assert.equal(rendered(component, 80).trim(), "No such session: 999");
  });

  it("list_sessions previews five entries, caches rows, and expands all entries with log paths", () => {
    const sessions: SessionListing[] = Array.from({ length: 7 }, (_, index) => ({
      session_id: index + 1,
      command: `sleep ${String(index + 1)}`,
      cwd: "/repo",
      tty: false,
      pid: 1000 + index,
      started_at_ms: 0,
      elapsed_ms: 1000 * (index + 1),
      running: true,
      wake_armed: index === 0,
      output_bytes_total: index,
      log_path: `/tmp/session-${String(index + 1)}.log`,
    }));
    let firstCommandReads = 0;
    const first = sessions[0];
    if (!first) throw new Error("expected a first session");
    Object.defineProperty(first, "command", {
      get: () => {
        firstCommandReads++;
        return "sleep 1";
      },
    });
    const result = makeResult({
      sessions,
      active_count: 7,
      just_exited_count: 0,
      tool_time_utc: "2026-08-04T00:00:00.000Z",
      output: "fallback should not render",
    });

    const collapsed = renderListSessionsResult(
      result,
      { expanded: false, isPartial: false },
      plainTheme,
      makeContext({}, {}),
    );
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
      makeContext({}, {}, collapsed),
    );
    const expandedText = rendered(expanded);
    assert.match(expandedText, /#7 /);
    assert.match(expandedText, /log: \/tmp\/session-7\.log/);
    assert.doesNotMatch(expandedText, /more sessions/);
  });
});
