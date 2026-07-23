import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  decideIdleDelivery,
  decideSendNow,
  decideTurnEndDelivery,
  type DeliveryGate,
} from "./delivery-policy.ts";
import { PromptHistory } from "./history-model.ts";
import { ManagerWindow } from "./manager-window.ts";
import { assistantStopReason, userMessageText } from "./message-text.ts";
import { PromptQueue, type QueueItemMode } from "./queue-model.ts";
import { QueuePromptEditor } from "./queue-editor.ts";
import { widgetLines, type WidgetPalette } from "./widget-lines.ts";
import { type ManagerResult, ManagerWindowState, type WindowTarget } from "./window-state.ts";

const WIDGET_KEY = "onurpi-prompt-queue";

type ManagerOutcome = Extract<ManagerResult, { kind: "close" | "resume" | "send-now" }>;

function palette(ctx: ExtensionContext): WidgetPalette {
  const theme = ctx.ui.theme;
  return {
    accent: (text) => theme.fg("accent", text),
    dim: (text) => theme.fg("dim", text),
    warning: (text) => theme.fg("warning", text),
  };
}

/** Runtime state and Pi wiring for the prompt queue extension. */
export class PromptQueueRuntime {
  readonly queue = new PromptQueue();
  readonly history = new PromptHistory();
  readonly gate: DeliveryGate = { windowOpen: false, held: false };
  private ctx: ExtensionContext | undefined;
  private intentionalAbortPending = false;
  private sendOnSettle: string | undefined;

  constructor(private readonly pi: ExtensionAPI) {}

  setContext(ctx: ExtensionContext): void {
    this.ctx = ctx;
  }

  private snapshot(): { hasSteer: boolean; hasAny: boolean } {
    return { hasSteer: this.queue.hasSteer(), hasAny: this.queue.size > 0 };
  }

  updateWidget(): void {
    const ctx = this.ctx;
    if (ctx?.mode !== "tui") return;
    const lines = widgetLines(this.queue.items(), this.gate, palette(ctx));
    ctx.ui.setWidget(WIDGET_KEY, lines.length > 0 ? lines : undefined);
  }

  deliverNextWhenIdle(): void {
    if (this.ctx?.isIdle() !== true) return;
    if (decideIdleDelivery(this.gate, this.snapshot()) !== "deliver-next") return;
    const item = this.queue.takeFirst();
    if (item) this.pi.sendUserMessage(item.text);
  }

  enqueue(text: string, mode: QueueItemMode): void {
    this.queue.add(text, mode);
    this.gate.held = false;
    this.deliverNextWhenIdle();
    this.updateWidget();
  }

  private sendNow(text: string, ctx: ExtensionContext): void {
    this.gate.held = false;
    if (decideSendNow(ctx.isIdle()) === "send") {
      this.pi.sendUserMessage(text);
      return;
    }
    this.intentionalAbortPending = true;
    this.sendOnSettle = text;
    ctx.abort();
  }

  onTurnEnd(message: unknown): void {
    const decision = decideTurnEndDelivery(
      this.gate,
      this.snapshot(),
      assistantStopReason(message),
    );
    if (decision === "deliver-steer") {
      const item = this.queue.takeFirstSteer();
      if (item) this.pi.sendUserMessage(item.text, { deliverAs: "steer" });
    }
    this.updateWidget();
  }

  onSettled(): void {
    if (this.sendOnSettle !== undefined) {
      const text = this.sendOnSettle;
      this.sendOnSettle = undefined;
      this.intentionalAbortPending = false;
      this.pi.sendUserMessage(text);
    } else {
      this.deliverNextWhenIdle();
    }
    this.updateWidget();
  }

  onAbort(): void {
    if (this.intentionalAbortPending) {
      this.intentionalAbortPending = false;
      return;
    }
    if (this.queue.size === 0 || this.gate.held) return;
    this.gate.held = true;
    this.ctx?.ui.notify(
      `Prompt queue paused (${String(this.queue.size)} pending). ` +
        "Resume with r in the manager (↑), /queue resume, or a new prompt.",
      "info",
    );
    this.updateWidget();
  }

  onDirectSubmit(): void {
    this.gate.held = false;
    this.updateWidget();
  }

  seedHistory(ctx: ExtensionContext): void {
    this.history.reset();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const text = userMessageText(entry.message);
      if (text !== undefined && text.trim().length > 0) this.history.add(text);
    }
  }

  private applyEdit(target: WindowTarget, text: string): void {
    if (target.kind === "queue") this.queue.update(target.id, text.trim());
    else this.history.updateAt(target.index, text);
  }

  private async runManager(
    ctx: ExtensionContext,
    state: ManagerWindowState,
  ): Promise<ManagerOutcome> {
    for (;;) {
      const result = await ctx.ui.custom<ManagerResult>(
        (tui, theme, _keybindings, done) => new ManagerWindow(state, tui, theme, done),
      );
      if (result.kind === "close" || result.kind === "resume" || result.kind === "send-now") {
        return result;
      }
      if (result.kind === "insert") {
        ctx.ui.setEditorText(result.text);
        return { kind: "close" };
      }
      const edited = await ctx.ui.editor("Edit prompt", result.text);
      if (edited !== undefined && edited.trim().length > 0) this.applyEdit(result.target, edited);
      this.updateWidget();
    }
  }

  async openManager(): Promise<void> {
    const ctx = this.ctx;
    if (ctx?.mode !== "tui" || this.gate.windowOpen) return;
    this.gate.windowOpen = true;
    this.updateWidget();
    let outcome: ManagerOutcome = { kind: "close" };
    try {
      outcome = await this.runManager(ctx, new ManagerWindowState(this.queue, this.history));
    } finally {
      this.gate.windowOpen = false;
      if (outcome.kind === "resume") this.gate.held = false;
      if (outcome.kind === "send-now") this.sendNow(outcome.text, ctx);
      else this.deliverNextWhenIdle();
      this.updateWidget();
    }
  }

  resume(): void {
    this.gate.held = false;
    this.deliverNextWhenIdle();
    this.updateWidget();
  }

  openManagerSafely(): void {
    this.openManager().catch((error: unknown) => {
      this.ctx?.ui.notify(`Prompt queue manager failed: ${String(error)}`, "error");
    });
  }

  installEditor(ctx: ExtensionContext): void {
    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) =>
        new QueuePromptEditor(tui, theme, keybindings, {
          isBusy: () => !(this.ctx?.isIdle() ?? true),
          enqueue: (text, mode) => {
            this.enqueue(text, mode);
          },
          openManager: () => {
            this.openManagerSafely();
          },
          recordHistory: (text) => {
            this.history.add(text);
          },
          onDirectSubmit: () => {
            this.onDirectSubmit();
          },
        }),
    );
  }
}

export default function promptQueue(pi: ExtensionAPI): void {
  const runtime = new PromptQueueRuntime(pi);

  pi.registerCommand("queue", {
    description: "Open the prompt queue and history manager; `resume` continues delivery",
    getArgumentCompletions: (prefix) =>
      "resume".startsWith(prefix) ? [{ value: "resume", label: "resume" }] : null,
    handler: async (args, ctx) => {
      runtime.setContext(ctx);
      if (args.trim() === "resume") {
        runtime.resume();
        return;
      }
      if (ctx.mode !== "tui") {
        ctx.ui.notify("The prompt queue manager needs interactive mode.", "warning");
        return;
      }
      await runtime.openManager();
    },
  });

  pi.on("session_start", (_event, ctx) => {
    runtime.setContext(ctx);
    runtime.seedHistory(ctx);
    if (ctx.mode === "tui") runtime.installEditor(ctx);
    runtime.updateWidget();
  });

  pi.on("turn_end", (event, ctx) => {
    runtime.setContext(ctx);
    runtime.onTurnEnd(event.message);
  });

  pi.on("agent_settled", (_event, ctx) => {
    runtime.setContext(ctx);
    runtime.onSettled();
  });

  pi.on("message_end", (event, ctx) => {
    runtime.setContext(ctx);
    if (assistantStopReason(event.message) === "aborted") runtime.onAbort();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    ctx.ui.setEditorComponent(undefined);
  });
}
