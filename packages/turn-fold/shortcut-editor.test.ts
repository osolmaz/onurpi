import type { EditorComponent } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { ToggleShortcutController, TurnFoldShortcutEditor } from "./shortcut-editor.ts";

const TOGGLE_KEY = "\x1b[111;6u";

class FakeEditor implements EditorComponent {
  borderColor?: (text: string) => string;
  focused = false;
  inputs: string[] = [];
  onChange?: (text: string) => void;
  onSubmit?: (text: string) => void;
  text = "";
  wantsKeyRelease = true;

  render(): string[] {
    return [this.text];
  }

  invalidate(): void {
    return;
  }

  handleInput(data: string): void {
    this.inputs.push(data);
  }

  getText(): string {
    return this.text;
  }

  setText(text: string): void {
    this.text = text;
  }
}

function shortcutEditor(base = new FakeEditor()) {
  const request = vi.fn(() => true);
  const cancel = vi.fn();
  return {
    base,
    cancel,
    editor: new TurnFoldShortcutEditor(base, { cancel, request }),
    request,
  };
}

describe("TurnFoldShortcutEditor", () => {
  it("submits the toggle command without replacing the editor draft", () => {
    const { base, editor, request } = shortcutEditor();
    base.text = "unfinished draft";
    const submit = vi.fn(() => {
      base.setText("");
    });
    editor.onSubmit = submit;

    editor.handleInput(TOGGLE_KEY);

    expect(request).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith("/turn-fold toggle");
    expect(base.text).toBe("unfinished draft");
  });

  it("suppresses dispatch when a toggle is already pending", () => {
    const base = new FakeEditor();
    const request = vi.fn(() => false);
    const editor = new TurnFoldShortcutEditor(base, { cancel: vi.fn(), request });
    const submit = vi.fn();
    editor.onSubmit = submit;

    editor.handleInput(TOGGLE_KEY);

    expect(submit).not.toHaveBeenCalled();
  });

  it("cancels the pending guard when submit is unavailable or throws", () => {
    const first = shortcutEditor();
    first.editor.handleInput(TOGGLE_KEY);
    expect(first.cancel).toHaveBeenCalledOnce();

    const second = shortcutEditor();
    second.base.text = "draft";
    second.editor.onSubmit = () => {
      second.base.setText("");
      throw new Error("submit failed");
    };
    expect(() => {
      second.editor.handleInput(TOGGLE_KEY);
    }).toThrow("submit failed");
    expect(second.cancel).toHaveBeenCalledOnce();
    expect(second.base.text).toBe("draft");
  });

  it("delegates other input and editor state to the wrapped editor", () => {
    const { base, editor, request } = shortcutEditor();

    editor.focused = true;
    editor.handleInput("x");
    editor.setText("text");

    expect(base.focused).toBe(true);
    expect(base.inputs).toEqual(["x"]);
    expect(editor.getText()).toBe("text");
    expect(editor.wantsKeyRelease).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("ToggleShortcutController", () => {
  it("queues one busy toggle and accepts another after cancellation", () => {
    const controller = new ToggleShortcutController();
    const notify = vi.fn();

    expect(controller.request(false, notify)).toBe(true);
    expect(controller.request(false, notify)).toBe(false);
    controller.cancel();
    expect(controller.request(true, notify)).toBe(true);

    expect(notify).toHaveBeenCalledWith(
      "Turn Fold toggle queued until the current response finishes.",
      "info",
    );
    expect(notify).toHaveBeenCalledWith("Turn Fold toggle already queued.", "info");
  });

  it("clears pending state when command execution succeeds or fails", async () => {
    const controller = new ToggleShortcutController();
    const notify = vi.fn();
    controller.request(true, notify);
    await controller.run(() => Promise.resolve());
    expect(controller.request(true, notify)).toBe(true);

    await expect(controller.run(() => Promise.reject(new Error("failed")))).rejects.toThrow(
      "failed",
    );
    expect(controller.request(true, notify)).toBe(true);
  });
});
