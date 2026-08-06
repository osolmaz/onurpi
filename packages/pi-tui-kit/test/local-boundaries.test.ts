import assert from "node:assert/strict";
import { test } from "vitest";
import { replaceTerminalControls } from "../src/components/rendering.js";
import { defineMenu, resolveMenuScreen } from "../src/model.js";
import { createMenuNavigator } from "../src/navigator.js";
import { runTask } from "../src/task.js";
import type { MenuDefinition, MenuScreen } from "../src/types.js";

type State = { count: number };
type ScreenId = "main" | "detail";
type ActionId = "run";

function definition(
  screen: MenuScreen<ScreenId, ActionId>,
): MenuDefinition<State, ScreenId, ActionId> {
  return defineMenu<State, ScreenId, ActionId>({
    start: "main",
    screens: { main: () => screen, detail: () => ({ kind: "detail", title: "d", lines: [] }) },
    actions: { run: () => undefined },
  });
}

function validate(screen: MenuScreen<ScreenId, ActionId>): void {
  resolveMenuScreen(definition(screen), "main", { count: 0 });
}

test("defineMenu rejects a start screen that is not registered", () => {
  assert.throws(
    () =>
      defineMenu<State, "main", ActionId>({
        start: "main",
        screens: {} as MenuDefinition<State, "main", ActionId>["screens"],
        actions: { run: () => undefined },
      }),
    /unknown screen: main/,
  );
});

test("resolveMenuScreen rejects unknown screens", () => {
  const menu = definition({ kind: "detail", title: "Main", lines: [] });
  assert.throws(() => resolveMenuScreen(menu, "nope" as ScreenId, { count: 0 }), /unknown screen/);
});

test("resolveMenuScreen rejects invalid screen shapes", () => {
  assert.throws(
    () => validate({ kind: "detail", title: " ", lines: [] }),
    /title must not be empty/,
  );
  assert.throws(
    () =>
      validate({
        kind: "settings",
        title: "Settings",
        items: [
          { id: "automatic", label: "Automatic", currentValue: "Off", values: [], action: "run" },
        ],
      }),
    /at least one value/,
  );
  assert.throws(
    () =>
      validate({
        kind: "settings",
        title: "Settings",
        items: [
          {
            id: "automatic",
            label: "Automatic",
            currentValue: "Maybe",
            values: ["On", "Off"],
            action: "run",
          },
        ],
      }),
    /values must include its current value/,
  );
  assert.throws(
    () =>
      validate({
        kind: "actions",
        title: "Main",
        items: [{ id: "go", label: "Go", to: "missing" as ScreenId }],
      }),
    /references unknown screen: missing/,
  );
});

test("navigator stays active until a close transition", () => {
  const navigator = createMenuNavigator<ScreenId>("main");
  assert.equal(navigator.apply({ kind: "to", screen: "detail" }), "active");
  assert.equal(navigator.current, "detail");
  assert.equal(navigator.apply({ kind: "back" }), "active");
  assert.equal(navigator.apply({ kind: "close" }), "closed");
  assert.equal(navigator.closeReason, "close");
  assert.equal(navigator.closed, true);
  assert.equal(navigator.apply({ kind: "stay" }), "closed");
});

test("replaceTerminalControls blanks control characters", () => {
  assert.equal(replaceTerminalControls("a\u0001b\u001b[7m"), "a b [7m");
  assert.equal(replaceTerminalControls(42), "42");
});

const nonTuiCtx = { mode: "rpc", hasUI: false, ui: {} } as never;

test("runTask reports stale when the invocation is no longer current", async () => {
  assert.deepEqual(
    await runTask(nonTuiCtx, { label: "x", isCurrent: () => false, task: () => 1 }),
    {
      kind: "stale",
    },
  );
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(
    await runTask(nonTuiCtx, { label: "x", signal: controller.signal, task: () => 1 }),
    { kind: "stale" },
  );
});

test("runTask reports stale when currency is lost during the task", async () => {
  let current = true;
  const result = await runTask(nonTuiCtx, {
    label: "x",
    isCurrent: () => current,
    task: () => {
      current = false;
      return 1;
    },
  });
  assert.deepEqual(result, { kind: "stale" });
});

test("runTask falls back to a notification when the error reporter fails", async () => {
  const notifications: string[] = [];
  const ctx = {
    mode: "rpc",
    hasUI: true,
    ui: {
      notify: (message: string) => {
        notifications.push(message);
      },
    },
  } as never;
  const failure = new Error("boom");
  const result = await runTask(ctx, {
    label: "x",
    task: () => {
      throw failure;
    },
    onError: () => {
      throw new Error("reporter failed");
    },
  });
  assert.deepEqual(result, { kind: "error", error: failure });
  assert.deepEqual(notifications, ["Task failed: boom"]);
});

test("runTask skips error notification without a UI", async () => {
  const failure = new Error("quiet");
  const result = await runTask(nonTuiCtx, {
    label: "x",
    task: () => Promise.reject(failure),
  });
  assert.deepEqual(result, { kind: "error", error: failure });
});
