import {
  AssistantMessageComponent,
  CompactionSummaryMessageComponent,
  initTheme,
  SkillInvocationMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, TUI, type Terminal, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, expect, it } from "vitest";

import { installRenderPatches, type RestoreRenderPatches } from "./render-patches.ts";
import { TurnFoldState } from "./turn-state.ts";

type AssistantMessage = NonNullable<ConstructorParameters<typeof AssistantMessageComponent>[0]>;

class MockTerminal implements Terminal {
  readonly columns = 120;
  readonly kittyProtocolActive = false;
  readonly rows = 40;

  clearFromCursor(): void {
    return;
  }
  clearLine(): void {
    return;
  }
  clearScreen(): void {
    return;
  }
  drainInput(): Promise<void> {
    return Promise.resolve();
  }
  hideCursor(): void {
    return;
  }
  moveBy(lines: number): void {
    void lines;
  }
  setProgress(active: boolean): void {
    void active;
  }
  setTitle(title: string): void {
    void title;
  }
  showCursor(): void {
    return;
  }
  start(onInput: (data: string) => void, onResize: () => void): void {
    void onInput;
    void onResize;
  }
  stop(): void {
    return;
  }
  write(data: string): void {
    void data;
  }
}

function assistantMessage(
  timestamp: number,
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    api: "test",
    content,
    model: "test-model",
    provider: "test",
    role: "assistant",
    stopReason,
    timestamp,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

function compactionEntry(id: string, timestamp: number) {
  return {
    firstKeptEntryId: "kept",
    id,
    parentId: null,
    summary: "Preserved summary",
    timestamp: new Date(timestamp).toISOString(),
    tokensBefore: 12_345,
    type: "compaction",
  };
}

function compactionComponent(timestamp: number): CompactionSummaryMessageComponent {
  return new CompactionSummaryMessageComponent({
    role: "compactionSummary",
    summary: "Preserved summary",
    timestamp,
    tokensBefore: 12_345,
  });
}

function stoppedTui(): TUI {
  const tui = new TUI(new MockTerminal());
  tui.stop();
  return tui;
}

function frame(transcript: Container, workingLine?: Text): string {
  const lines = transcript.render(120);
  if (workingLine) lines.push(...workingLine.render(120));
  return lines.join("\n");
}

function toolNames(rendered: string): string[] {
  return rendered.match(/tool_\d+/gu) ?? [];
}

initTheme("dark", false);

let restore: RestoreRenderPatches | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
});

it("restores the compaction component prototype exactly", () => {
  const prototype = CompactionSummaryMessageComponent.prototype;
  const originalRender: unknown = Reflect.get(prototype, "render");
  const hadOwnRender = Object.prototype.hasOwnProperty.call(prototype, "render");

  restore = installRenderPatches(new TurnFoldState(), () => undefined);
  expect(Object.prototype.hasOwnProperty.call(prototype, "render")).toBe(true);
  restore();
  restore = undefined;

  expect(Reflect.get(prototype, "render")).toBe(originalRender);
  expect(Object.prototype.hasOwnProperty.call(prototype, "render")).toBe(hadOwnRender);
});

it("keeps only the user message's built-in top padding", () => {
  const state = new TurnFoldState();
  const transcript = new Container();
  const userSpacer = new Spacer(1);
  const ordinarySpacer = new Spacer(1);
  restore = installRenderPatches(state, () => undefined);

  transcript.addChild(userSpacer);
  transcript.addChild(new UserMessageComponent("Prompt", undefined, 0));
  transcript.addChild(ordinarySpacer);
  transcript.addChild(new Text("Other", 0, 0));

  expect(userSpacer.render(40)).toEqual([]);
  expect(ordinarySpacer.render(40)).toEqual([""]);
});

it("renders local user and completion times in transcript order", () => {
  const state = new TurnFoldState();
  const transcript = new Container();
  restore = installRenderPatches(state, () => undefined);
  const startedAt = new Date();
  startedAt.setHours(8, 5, 0, 0);
  const completedAt = new Date(startedAt);
  completedAt.setMinutes(6);
  const final = assistantMessage(completedAt.getTime(), [{ text: "Final response", type: "text" }]);

  state.loadHistory([
    {
      message: { content: "Prompt", role: "user", timestamp: startedAt.getTime() },
      type: "message",
    },
    { message: final, timestamp: completedAt.toISOString(), type: "message" },
  ]);
  transcript.addChild(new UserMessageComponent("Prompt", undefined, 0));
  transcript.addChild(new AssistantMessageComponent(final, false, undefined, undefined, 0));

  const rendered = frame(transcript);
  expect(rendered.indexOf("Prompt")).toBeLessThan(rendered.indexOf("08:05"));
  expect(rendered.indexOf("08:05")).toBeLessThan(rendered.indexOf("Worked for"));
  expect(rendered).toContain("Worked for 1m · 1 msg");
  expect(rendered.indexOf("Worked for")).toBeLessThan(rendered.indexOf("Final response"));
  expect(rendered.indexOf("Final response")).toBeLessThan(rendered.indexOf("08:06"));
  expect(rendered).not.toContain("Ctrl+Shift+O");
});

it("renders edit diffstats only in compact summaries", () => {
  const state = new TurnFoldState();
  const transcript = new Container();
  restore = installRenderPatches(state, () => undefined);
  const toolCaller = assistantMessage(110, [
    {
      arguments: { edits: [{ newText: "new", oldText: "old" }], path: "src/example.ts" },
      id: "edit-live",
      name: "edit",
      type: "toolCall",
    },
  ]);
  const final = assistantMessage(140, [{ text: "Final response", type: "text" }]);
  const editResult = {
    content: [{ text: "edited", type: "text" as const }],
    details: {
      patch: [
        "--- src/example.ts",
        "+++ src/example.ts",
        "@@ -1,1 +1,2 @@",
        "-old",
        "+new",
        "+added",
        "",
      ].join("\n"),
    },
    isError: false,
    role: "toolResult" as const,
    timestamp: 130,
    toolCallId: "edit-live",
    toolName: "edit",
  };

  state.loadHistory([
    { message: { content: "Prompt", role: "user", timestamp: 100 }, type: "message" },
    { message: toolCaller, type: "message" },
    { message: editResult, type: "message" },
    { message: final, timestamp: new Date(150).toISOString(), type: "message" },
  ]);
  transcript.addChild(new UserMessageComponent("Prompt", undefined, 0));
  transcript.addChild(new AssistantMessageComponent(toolCaller, false, undefined, undefined, 0));
  transcript.addChild(new AssistantMessageComponent(final, false, undefined, undefined, 0));

  expect(frame(transcript)).toContain("1 file +2 −1");
  state.setMode("expanded");
  expect(frame(transcript)).not.toContain("1 file +2 −1");
});

it("timestamps every visible user and assistant message in both modes", () => {
  const state = new TurnFoldState();
  const transcript = new Container();
  restore = installRenderPatches(state, () => undefined);
  const userAt = new Date();
  userAt.setHours(8, 1, 0, 0);
  const firstAt = new Date(userAt);
  firstAt.setMinutes(2);
  const finalAt = new Date(userAt);
  finalAt.setMinutes(3);
  const first = assistantMessage(firstAt.getTime(), [{ text: "First response", type: "text" }]);
  const final = assistantMessage(finalAt.getTime(), [{ text: "Final response", type: "text" }]);

  state.loadHistory([
    { message: { content: "Prompt", role: "user", timestamp: userAt.getTime() }, type: "message" },
    { message: first, timestamp: firstAt.toISOString(), type: "message" },
    { message: final, timestamp: finalAt.toISOString(), type: "message" },
  ]);
  transcript.addChild(new UserMessageComponent("Prompt", undefined, 0));
  transcript.addChild(new AssistantMessageComponent(first, false, undefined, undefined, 0));
  transcript.addChild(new AssistantMessageComponent(final, false, undefined, undefined, 0));

  state.setMode("expanded");
  const expanded = frame(transcript);
  expect(expanded.match(/08:01/gu)).toHaveLength(1);
  expect(expanded.match(/08:02/gu)).toHaveLength(1);
  expect(expanded.match(/08:03/gu)).toHaveLength(1);

  state.setMode("compact");
  const compact = frame(transcript);
  expect(compact.match(/08:01/gu)).toHaveLength(1);
  expect(compact).not.toContain("08:02");
  expect(compact.match(/08:03/gu)).toHaveLength(1);
});

it("folds an automatic compaction into the turn summary", () => {
  const state = new TurnFoldState();
  const transcript = new Container();
  restore = installRenderPatches(state, () => undefined);
  const final = assistantMessage(140, [{ text: "Final response", type: "text" }]);

  state.loadHistory(
    [
      compactionEntry("compact-auto", 120),
      {
        id: "turn-user",
        message: { content: "Prompt", role: "user", timestamp: 100 },
        type: "message",
      },
      {
        id: "turn-assistant",
        message: final,
        timestamp: new Date(150).toISOString(),
        type: "message",
      },
    ],
    new Map([
      [
        "compact-auto",
        {
          compactionEntryId: "compact-auto",
          timestamp: 120,
          turnEntryIds: ["turn-user", "turn-assistant"],
          turnStartedAt: 100,
        },
      ],
    ]),
  );
  transcript.addChild(new UserMessageComponent("Prompt", undefined, 0));
  const compactionSpacer = new Spacer(1);
  transcript.addChild(compactionSpacer);
  transcript.addChild(compactionComponent(120));
  transcript.addChild(new AssistantMessageComponent(final, false, undefined, undefined, 0));

  const compact = frame(transcript);
  expect(compact).toContain("Worked for <1s · 1 msg · compacted");
  expect(compact).toContain("Final response");
  expect(compact).not.toContain("[compaction]");
  expect(compact).not.toContain("Compacted from 12,345 tokens");
  expect(compactionSpacer.render(120)).toEqual([]);

  state.setMode("expanded");
  const expanded = frame(transcript);
  expect(expanded).toContain("[compaction]");
  expect(expanded).toContain("Compacted from 12,345 tokens");
  expect(compactionSpacer.render(120)).toEqual([""]);
});

it("folds both compaction rows emitted after a live automatic compaction", () => {
  const state = new TurnFoldState();
  const transcript = new Container();
  restore = installRenderPatches(state, () => undefined);
  const final = assistantMessage(140, [{ text: "Final response", type: "text" }]);

  state.ensureActive(100);
  state.registerCompaction(compactionEntry("compact-live", 120), "threshold");
  const rebuiltSpacer = new Spacer(1);
  const liveSpacer = new Spacer(1);
  transcript.addChild(rebuiltSpacer);
  transcript.addChild(compactionComponent(120));
  transcript.addChild(liveSpacer);
  transcript.addChild(compactionComponent(125));
  state.registerAssistantMessage(final);
  transcript.addChild(new AssistantMessageComponent(final, false, undefined, undefined, 0));
  state.settleActive(150);

  const compact = frame(transcript);
  expect(compact).toContain("Worked for <1s · 1 msg · compacted");
  expect(compact).not.toContain("[compaction]");
  expect(rebuiltSpacer.render(120)).toEqual([]);
  expect(liveSpacer.render(120)).toEqual([]);

  state.setMode("expanded");
  expect(frame(transcript).match(/\[compaction\]/gu)).toHaveLength(2);
  expect(rebuiltSpacer.render(120)).toEqual([""]);
  expect(liveSpacer.render(120)).toEqual([""]);
});

it("keeps a manual idle compaction as a standalone row", () => {
  const state = new TurnFoldState();
  const transcript = new Container();
  restore = installRenderPatches(state, () => undefined);
  const final = assistantMessage(140, [{ text: "Final response", type: "text" }]);

  state.loadHistory([
    { message: { content: "Prompt", role: "user", timestamp: 100 }, type: "message" },
    { message: final, timestamp: new Date(150).toISOString(), type: "message" },
    compactionEntry("compact-manual", 160),
  ]);
  transcript.addChild(new UserMessageComponent("Prompt", undefined, 0));
  transcript.addChild(new AssistantMessageComponent(final, false, undefined, undefined, 0));
  const compactionSpacer = new Spacer(1);
  transcript.addChild(compactionSpacer);
  transcript.addChild(compactionComponent(160));

  const rendered = frame(transcript);
  expect(rendered).toContain("Worked for <1s · 1 msg");
  expect(rendered).not.toContain("compacted");
  expect(rendered).toContain("[compaction]");
  expect(rendered).toContain("Compacted from 12,345 tokens");
  expect(compactionSpacer.render(120)).toEqual([""]);
});

it("timestamps skill-only user rows without duplicating timestamps", () => {
  const state = new TurnFoldState();
  const transcript = new Container();
  restore = installRenderPatches(state, () => undefined);
  const firstAt = new Date();
  firstAt.setHours(9, 10, 0, 0);
  const secondAt = new Date(firstAt);
  secondAt.setMinutes(11);

  state.loadHistory([
    { message: { content: "first", role: "user", timestamp: firstAt.getTime() }, type: "message" },
    {
      message: { content: "second", role: "user", timestamp: secondAt.getTime() },
      type: "message",
    },
  ]);
  transcript.addChild(
    new SkillInvocationMessageComponent({
      content: "skill body",
      location: "/tmp/SKILL.md",
      name: "test-skill",
      userMessage: "Visible prompt",
    }),
  );
  transcript.addChild(new UserMessageComponent("Visible prompt", undefined, 0));
  transcript.addChild(
    new SkillInvocationMessageComponent({
      content: "skill body",
      location: "/tmp/SKILL.md",
      name: "skill-only",
      userMessage: undefined,
    }),
  );

  const rendered = frame(transcript);
  expect(rendered.match(/09:10/gu)).toHaveLength(1);
  expect(rendered.match(/09:11/gu)).toHaveLength(1);
});

it("compacts ten sequential tool calls while leaving the working line visible", () => {
  const state = new TurnFoldState();
  const transcript = new Container();
  const workingLine = new Text("◆ Working", 0, 0);
  const ui = stoppedTui();
  restore = installRenderPatches(state, () => undefined);
  state.ensureActive(100);

  for (let index = 1; index <= 10; index += 1) {
    const toolCallId = `call-${String(index)}`;
    state.registerToolStart(toolCallId, 100 + index);
    const component = new ToolExecutionComponent(
      `tool_${String(index)}`,
      toolCallId,
      { index },
      undefined,
      undefined,
      ui,
      "/tmp",
    );
    component.markExecutionStarted();
    transcript.addChild(component);

    const rendered = frame(transcript, workingLine);
    expect(rendered).toContain("◆ Working");
    expect(toolNames(rendered)).toHaveLength(Math.min(index, 3));
    if (index > 3) {
      const hidden = index - 3;
      expect(rendered).toContain(
        `${String(hidden)} earlier ${hidden === 1 ? "activity" : "activities"}`,
      );
    }
  }

  const activeFrame = frame(transcript, workingLine);
  expect(activeFrame.indexOf("7 earlier activities")).toBeLessThan(activeFrame.indexOf("tool_8"));
  expect(toolNames(activeFrame)).toEqual(["tool_8", "tool_9", "tool_10"]);

  const finalMessage = assistantMessage(200, [{ text: "Final response", type: "text" }]);
  state.registerAssistantMessage(finalMessage);
  const finalComponent = new AssistantMessageComponent(
    finalMessage,
    false,
    undefined,
    undefined,
    0,
  );
  transcript.addChild(finalComponent);
  state.settleActive(250);

  const settledFrame = frame(transcript);
  expect(toolNames(settledFrame)).toEqual([]);
  expect(settledFrame).toContain("Final response");
  expect(settledFrame).toContain("Worked for");
  expect(settledFrame.indexOf("Worked for")).toBeLessThan(settledFrame.indexOf("Final response"));

  state.setMode("expanded");
  expect(toolNames(frame(transcript))).toHaveLength(10);
});

it("chooses the final historical tool on the first replay frame", () => {
  const state = new TurnFoldState();
  const transcript = new Container();
  const ui = stoppedTui();
  restore = installRenderPatches(state, () => undefined);
  const toolCallMessage = assistantMessage(
    110,
    [1, 2, 3].map((index) => ({
      arguments: {},
      id: `historical-${String(index)}`,
      name: `tool_${String(index)}`,
      type: "toolCall" as const,
    })),
    "toolUse",
  );
  state.loadHistory([
    { message: { content: "prompt", role: "user", timestamp: 100 }, type: "message" },
    { message: toolCallMessage, timestamp: new Date(120).toISOString(), type: "message" },
    ...[1, 2, 3].map((index) => ({
      message: {
        content: [{ text: `result ${String(index)}`, type: "text" }],
        isError: false,
        role: "toolResult",
        timestamp: 120 + index,
        toolCallId: `historical-${String(index)}`,
      },
      timestamp: new Date(130 + index).toISOString(),
      type: "message",
    })),
  ]);
  transcript.addChild(
    new AssistantMessageComponent(toolCallMessage, false, undefined, undefined, 0),
  );
  for (let index = 1; index <= 3; index += 1) {
    const tool = new ToolExecutionComponent(
      `tool_${String(index)}`,
      `historical-${String(index)}`,
      {},
      undefined,
      undefined,
      ui,
      "/tmp",
    );
    tool.updateResult({
      content: [{ text: `result ${String(index)}`, type: "text" }],
      isError: false,
    });
    transcript.addChild(tool);
  }

  const firstFrame = frame(transcript);
  expect(toolNames(firstFrame)).toEqual(["tool_3"]);
  expect(firstFrame.match(/Worked for/gu)).toHaveLength(1);
  expect(firstFrame.indexOf("Worked for")).toBeLessThan(firstFrame.indexOf("tool_3"));
});

it("renders an interruption fallback after the worked line", () => {
  const state = new TurnFoldState();
  const transcript = new Container();
  restore = installRenderPatches(state, () => undefined);
  state.ensureActive(100);

  const interrupted = assistantMessage(
    120,
    [{ arguments: {}, id: "unfinished", name: "tool", type: "toolCall" }],
    "aborted",
  );
  state.registerAssistantMessage(interrupted);
  transcript.addChild(new AssistantMessageComponent(interrupted, false, undefined, undefined, 0));
  state.abortActive(150);

  const rendered = frame(transcript);
  expect(rendered).toContain("Operation interrupted");
  expect(rendered).toContain("Worked for");
  expect(rendered.indexOf("Worked for")).toBeLessThan(rendered.indexOf("Operation interrupted"));
  expect(transcript.render(8).every((line) => visibleWidth(line) <= 8)).toBe(true);
  expect(transcript.render(0)).toEqual([]);
});

it("keeps a pending tool error visible after the worked line", () => {
  const state = new TurnFoldState();
  const transcript = new Container();
  const ui = stoppedTui();
  restore = installRenderPatches(state, () => undefined);

  const failed = assistantMessage(
    120,
    [
      { text: "Stale partial response", type: "text" },
      { arguments: {}, id: "failed-tool-1", name: "tool", type: "toolCall" },
      { arguments: {}, id: "failed-tool-2", name: "tool", type: "toolCall" },
    ],
    "error",
  );
  state.loadHistory([
    { message: { content: "prompt", role: "user", timestamp: 100 }, type: "message" },
    { message: failed, timestamp: new Date(150).toISOString(), type: "message" },
  ]);
  transcript.addChild(new AssistantMessageComponent(failed, false, undefined, undefined, 0));
  for (const index of [1, 2]) {
    const toolCallId = `failed-tool-${String(index)}`;
    const tool = new ToolExecutionComponent(
      `failed_tool_${String(index)}`,
      toolCallId,
      {},
      undefined,
      undefined,
      ui,
      "/tmp",
    );
    tool.updateResult({
      content: [{ text: `Provider failure ${String(index)}`, type: "text" }],
      isError: true,
    });
    transcript.addChild(tool);
  }

  const rendered = frame(transcript);
  expect(rendered).not.toContain("Provider failure 1");
  expect(rendered).toContain("Provider failure 2");
  expect(rendered).not.toContain("Stale partial response");
  expect(rendered).toContain("2 failures");
  expect(rendered.indexOf("Worked for")).toBeLessThan(rendered.indexOf("Provider failure 2"));
  expect(rendered).not.toContain("Operation interrupted");
});
