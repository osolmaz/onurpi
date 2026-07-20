import {
  AssistantMessageComponent,
  initTheme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, Text, TUI, type Terminal, visibleWidth } from "@earendil-works/pi-tui";
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
  expect(settledFrame.indexOf("Final response")).toBeLessThan(settledFrame.indexOf("Worked for"));

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
});

it("renders an interruption fallback before the worked line", () => {
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
  expect(rendered.indexOf("Operation interrupted")).toBeLessThan(rendered.indexOf("Worked for"));
  expect(transcript.render(8).every((line) => visibleWidth(line) <= 8)).toBe(true);
  expect(transcript.render(0)).toEqual([]);
});

it("keeps a pending tool error visible before the worked line", () => {
  const state = new TurnFoldState();
  const transcript = new Container();
  const ui = stoppedTui();
  restore = installRenderPatches(state, () => undefined);
  state.ensureActive(100);

  const failed = assistantMessage(
    120,
    [
      { text: "Stale partial response", type: "text" },
      { arguments: {}, id: "failed-tool-1", name: "tool", type: "toolCall" },
      { arguments: {}, id: "failed-tool-2", name: "tool", type: "toolCall" },
    ],
    "error",
  );
  state.registerAssistantMessage(failed);
  transcript.addChild(new AssistantMessageComponent(failed, false, undefined, undefined, 0));
  for (const index of [1, 2]) {
    const toolCallId = `failed-tool-${String(index)}`;
    state.registerToolStart(toolCallId, 124 + index);
    const tool = new ToolExecutionComponent(
      `failed_tool_${String(index)}`,
      toolCallId,
      {},
      undefined,
      undefined,
      ui,
      "/tmp",
    );
    tool.markExecutionStarted();
    tool.updateResult({
      content: [{ text: `Provider failure ${String(index)}`, type: "text" }],
      isError: true,
    });
    transcript.addChild(tool);
  }
  state.settleActive(150);

  const rendered = frame(transcript);
  expect(rendered).not.toContain("Provider failure 1");
  expect(rendered).toContain("Provider failure 2");
  expect(rendered).not.toContain("Stale partial response");
  expect(rendered).toContain("2 failures");
  expect(rendered.indexOf("Provider failure 2")).toBeLessThan(rendered.indexOf("Worked for"));
  expect(rendered).not.toContain("Operation interrupted");
});
