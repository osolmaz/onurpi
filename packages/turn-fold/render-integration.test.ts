import {
  AssistantMessageComponent,
  initTheme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, Text, TUI, type Terminal } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";

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

describe("real Pi component render patches", () => {
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
  });
});
