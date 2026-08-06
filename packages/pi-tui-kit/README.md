# 🧭 Pi TUI Kit

[![npm](https://img.shields.io/npm/v/@narumitw/pi-tui-kit)](https://www.npmjs.com/package/@narumitw/pi-tui-kit)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Reusable navigation helpers and typed, declarative interaction flows for independently installable
[Pi](https://pi.dev) extensions, built on
[`@earendil-works/pi-tui`](https://www.npmjs.com/package/@earendil-works/pi-tui). The initial
high-level API lets extensions describe menu screens and domain actions while this package owns
standard rendering, navigation, mode adaptation, cancellation, and lifecycle behavior. It also
provides a standalone task runner for abort-aware work with a cancellable bordered loader composed
from public Pi TUI primitives.

## 📦 Install

Add the library as a runtime dependency of the extension package:

```bash
npm install @narumitw/pi-tui-kit
```

The published package contains built ESM and declarations in `dist/`; consumers do not need a
TypeScript loader for dependencies.

### Compatibility floor

Pi TUI Kit is still a zero-major package, so caret ranges are minor-bounded: for example,
`^0.40.0` accepts releases from `0.40.0` up to, but not including, `0.41.0`. When an extension adopts
an API introduced in a later Kit minor, raise that extension's minimum compatible minor rather than
using a broad `<1` range. Otherwise an existing npm lock can retain an older Kit that lacks the
screen or contract the extension expects.

Compatibility ranges are consumer-owned. Review each extension against the APIs it imports and keep
its tested minimum; do not automatically synchronize every consumer range with the current workspace
package version during a shared release bump. In this monorepo, declare the dependency in the
consuming package so local hoisting cannot hide an incompatible or missing published dependency.

## ⚡ Runtime performance

The Kit's production JavaScript imports Pi TUI at runtime but keeps Pi Coding Agent imports type-only.
This prevents a source-loaded extension from evaluating a second heavyweight coding-agent runtime
when its menu first opens. Borders and task loaders compose public Pi TUI primitives with the theme
and keybindings supplied by the active UI callback; review syntax coloring uses the Kit's declared
highlighter dependency and the same callback theme.

Repository maintainers can measure cold package import, first actions/review frame, and first task
frame in fresh serial processes:

```bash
npm run build --workspace @narumitw/pi-tui-kit
node scripts/benchmark-tui-kit-runtime.mjs --runs 5
```

The benchmark reports medians, median absolute deviations, and resolved package URLs so a fast import
cannot hide the same dependency cost in the first interaction.

## 🚀 Example

```ts
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { defineMenu, type MenuCloseReason, runMenu } from "@narumitw/pi-tui-kit";

type Screen = "main" | "settings";
type Action = "refresh" | "setMode";
interface State {
  mode: "Safe" | "Fast";
}

declare function refreshDomainState(signal: AbortSignal): Promise<void>;
declare function saveMode(mode: State["mode"], signal: AbortSignal): Promise<void>;
declare function loadState(signal: AbortSignal): Promise<State>;
declare function currentGeneration(): number;
declare function formatError(error: unknown): string;

const menu = defineMenu<State, Screen, Action>({
  start: "main",
  screens: {
    main: ({ state }) => ({
      kind: "actions",
      title: "Example extension",
      lines: [`Current mode: ${state.mode}`],
      items: [
        { id: "refresh", label: "Refresh", action: "refresh", busyLabel: "Refreshing" },
        { id: "settings", label: "Settings", to: "settings" },
        { id: "close", label: "Close", close: true },
      ],
      hint: "close",
    }),
    settings: ({ state }) => ({
      kind: "settings",
      title: "Settings",
      items: [
        {
          id: "mode",
          label: "Mode",
          currentValue: state.mode,
          values: ["Safe", "Fast"],
          action: "setMode",
        },
      ],
    }),
  },
  actions: {
    refresh: async ({ signal }) => {
      await refreshDomainState(signal);
      return { kind: "stay" };
    },
    setMode: async ({ value, signal }) => {
      await saveMode(value === "Fast" ? "Fast" : "Safe", signal);
      return { kind: "stay" };
    },
  },
});

export async function showMenu(ctx: ExtensionCommandContext, generation: number) {
  const result = await runMenu(ctx, menu, {
    getState: ({ signal }) => loadState(signal),
    signal: currentSessionSignal(),
    isCurrent: () => generation === currentGeneration(),
    onError: (_ctx, error) => ctx.ui.notify(formatError(error), "error"),
    onUnsupportedMode: (_ctx, mode) => {
      ctx.ui.notify(`The menu is unavailable in ${mode} mode.`, "warning");
    },
  });
  if (result.kind === "closed") {
    const reason: MenuCloseReason = result.reason;
    if (reason === "back") ctx.ui.notify("Returned from the root menu", "info");
  }
  return result;
}
```

The state loader runs again whenever a screen is entered or refreshed, so screen factories can
remain pure projections of current extension state. An ordinary terminal result is
`{ kind: "closed", reason: "back" | "close" }`: root Back reports `back`; Ctrl+C, a Close hint,
a close row, or an accepted action that returns Close reports `close`. Nested Back remains inside the
menu. RPC preserves each adapter's existing transition: a generic cancelled selector applies Back,
while input and review cancellation follow their declared hint. Owner replacement remains `stale`
and takes precedence over any racing Close event.

For abort-aware work outside a menu, use `runTask()`. TUI mode shows the Kit's Pi-styled cancellable
bordered loader; RPC, print, and JSON execute the same task directly. User cancellation, owner
replacement, external component disposal, errors, and successful completion remain distinct typed
results.

```ts
import { runTask } from "@narumitw/pi-tui-kit";

const result = await runTask(ctx, {
  label: "Refreshing domain state…",
  signal: currentSessionSignal(),
  isCurrent: () => generation === currentGeneration(),
  task: ({ signal }) => refreshDomainState(signal),
  onError: (_ctx, error) => ctx.ui.notify(formatError(error), "error"),
});

if (result.kind === "completed") ctx.ui.notify("Refreshed", "info");
```

A task must honor its supplied signal. The runner aborts and drains owned work before returning; it
does not hide an uncooperative task behind an arbitrary timeout.

For a specialized custom component that does not belong in the declarative screen union, use
`runCustomInteraction()`. It supplies an interaction-owned signal, classifies owner replacement and
external component disposal as stale, disposes exactly once, and drains optional `waitForPending()`
work before returning. The consumer still owns the component, its Back/Close value, and every domain
side effect. Async factories and pending work must honor the supplied signal; the helper drains them
but does not hide uncooperative work behind a timeout.

```ts
import { runCustomInteraction } from "@narumitw/pi-tui-kit";

const result = await runCustomInteraction<{ kind: "back" | "close" }>(ctx, {
  signal: currentSessionSignal(),
  isCurrent: () => generation === currentGeneration(),
  create: ({ keybindings, signal, complete }) => ({
    render: () => [signal.aborted ? "Closing…" : "Specialized view"],
    invalidate() {},
    handleInput(data) {
      if (keybindings.matches(data, "tui.select.cancel")) complete({ kind: "back" });
    },
  }),
});
```

## 🖥️ Standard screens

`defineMenu()` supports eight standard screen kinds:

- **`actions`** — navigation targets, domain actions, close rows, and optional cancellable busy
  labels.
- **`detail`** — read-only wrapped text with Back or Close behavior.
- **`browse`** — a read-only searchable catalog with textual status, adaptive list/detail views,
  stable selection restoration, and paginated RPC details.
- **`choice`** — one confirmed value from a static list, with separate current and initial items,
  selected details, disabled explanations, and a bounded viewport.
- **`settings`** — Pi-style searchable, aligned settings rows with immediate value changes,
  serialized saves, and rollback when an action rejects.
- **`input`** — single-line text entry inside the menu stack with IME focus, serialized submission,
  rejected-draft retention, and TUI/RPC adaptation.
- **`review`** — fixed or terminal-adaptive scrollable exact text, code, or diff content with an
  optional primary confirmation action and paginated RPC fallback.
- **`multiSelect`** — optimistic toggles with stable cursor restoration, serialized saves, rollback,
  selected-row descriptions, optional fuzzy search and bulk action rows, and a bounded TUI viewport.

All standard TUI screens use Pi's injected keybindings, sanitize display text, rebuild themed
content after invalidation, and bound rendered output to the supplied terminal width. Escape follows
the screen's Back/Close hint; `Ctrl+C` closes the menu.

Choice screens are for bounded static alternatives rather than actions that run while the cursor
moves. `currentItemId` adds the textual current marker; `initialItemId` controls the first cursor when
there is no remembered selection. They remain separate so a custom or legacy current value can focus
a safe fallback. A confirmed row invokes the screen action with its raw `itemId`; moving the cursor
only changes selected details. Rejected or thrown actions retain the selection. Disabled rows stay
focusable for their explanation but never invoke the action. RPC flattens choice rows to unique dialog
labels while preserving raw identity.

```ts
const profileScreen = {
  kind: "choice" as const,
  title: "Information profile",
  lines: ["Current profile: custom"],
  items: [
    {
      id: "minimal",
      label: "Minimal",
      description: "Four segments",
      details: ["Segments: model · cwd · branch · context"],
    },
    {
      id: "balanced",
      label: "Balanced",
      description: "Recommended",
      details: ["Segments: model · thinking · cwd · branch · tools · context · time"],
    },
  ],
  action: "setProfile" as const,
  currentItemId: "custom", // May be absent from items; no false current marker is shown.
  initialItemId: "balanced",
  viewportSize: 8,
};
```

Keep live previews, preview rollback, persistence, and confirmation policy in the consuming extension;
a specialized UI remains appropriate when cursor movement itself has side effects.

Browse screens are read-only and invoke no action. TUI fuzzy-searches each sanitized label, textual
`statusText`, description, and optional non-rendered `searchText`. Enter opens an adaptive scrolling
detail view; Escape returns to the list without losing the query or selected raw id, then returns to
the parent, while Ctrl+C closes the menu. Omitted or `"adaptive"` viewport size uses the live terminal
row budget; a positive number caps item rows without disabling terminal bounds. RPC intentionally
keeps one deterministic unfiltered list, then presents bounded detail pages; `searchText` is never
rendered.

```ts
const modulesScreen = {
  kind: "browse" as const,
  title: "Modules",
  items: modules.map((module) => ({
    id: module.name,
    label: module.name,
    statusText: module.state,
    description: module.description,
    searchText: module.variables.join(" "),
    details: [
      `Preview: ${module.preview || "none"}`,
      `Variables: ${module.variables.join(", ") || "none"}`,
    ],
  })),
  viewportSize: "adaptive" as const,
};
```

Use `choice` when confirmation invokes a domain action; use `browse` when selection only reveals
information. Domain status meaning, catalog construction, and data freshness remain consumer-owned.

TUI settings screens retain the extension title and supporting context above Pi's familiar search
field, aligned label/value columns, ten-row viewport, position indicator, selected-row description,
and keyboard hint. Typing fuzzy-filters labels, arrows navigate, and Enter or Space changes the
selected value. Changes save immediately, so Back or Close never implies rollback. The embedded
search input forwards focus for IME positioning. The kit owns this adapter because Pi's public
`SettingsList` does not currently expose restored-cursor, disabled-row, async rollback, and search
focus behavior together.

Input screens submit through the existing action `value`. Validation, normalization, persistence,
and product copy remain extension-owned. Rejection keeps the TUI draft available for correction;
RPC reopens its signal-aware input dialog.

```ts
const inputScreen = {
  kind: "input" as const,
  title: "Maximum image count",
  lines: ["Current: 20"],
  placeholder: "Enter a positive integer",
  action: "setMaximum" as const,
};
```

Review screens preserve indentation and hard-wrap by terminal cells rather than prose words. Their
viewport supports Up, Down, Page Up, Page Down, Home, and End. RPC sends bounded pages instead of one
unbounded dialog title. Treat `content` as untrusted display input; the kit strips terminal controls
before formatting it.

```ts
const reviewScreen = {
  kind: "review" as const,
  title: "Review configuration changes",
  content: unifiedDiff,
  format: { kind: "diff" as const, filePath: settingsPath },
  viewportSize: "adaptive",
  confirm: { id: "apply", label: "Apply", action: "apply" as const },
};
```

Review formats are `{ kind: "text" }`, `{ kind: "code", language?, filePath? }`, and
`{ kind: "diff", filePath? }`. Omitted `viewportSize` keeps the fixed 14-row TUI viewport, and
numeric values remain fixed integers from 1 through 50. Set `viewportSize: "adaptive"` to recompute
from the live terminal height on every TUI render. Adaptive review reserves three terminal rows for
Pi-owned UI and keeps the complete frame within `max(1, floor(terminal rows) - 3)` rows; this mode is
not capped at the numeric 50-row maximum.

At constrained heights, adaptive review prioritizes one content row, then a compact title, then a
compact confirmation/Back-or-Close/navigation hint. From four available rows it shows position when
content scrolls; additional space restores wrapped title and supporting context, the full keyboard
hint, and the separator before enlarging the content viewport. Fixed and omitted review rendering is
unchanged. RPC does not read terminal dimensions: adaptive and omitted reviews use deterministic
pages of at most eight rows, while numeric values retain the existing eight-row cap. A review without
`confirm` is read-only. Escape follows Back/Close and `Ctrl+C` closes the whole menu.

Action handlers return one of these results:

```ts
{ kind: "stay" }
{ kind: "back" }
{ kind: "close" }
{ kind: "to", screen: "another-screen" }
{ kind: "rejected", error?: unknown }
```

A rejected settings or multi-select action restores the last accepted value. Throwing has the same
recovery behavior and is routed through `onError`.

For a large multi-select, set `viewportSize` to the maximum number of toggle and action rows rendered
at once. Up and Down wrap; Page Up and Page Down move by one viewport and clamp at the first or last
row. Descriptions for the selected row appear below the viewport.

Set `enableSearch: true` when toggle rows can become difficult to scan. TUI typing fuzzy-filters each
sanitized label plus optional non-rendered `searchText`; use that field for source, policy, aliases, or
other useful metadata without parsing display labels or raw IDs. The query is local to the current
screen instance. Rows in `actions` remain pinned below the matches, including when there are no
matching toggle rows, so Save, Discard, and bulk workflows stay reachable. Clearing the query restores
a valid stable-ID selection. The embedded public Pi `Input` forwards focus for IME positioning and
sanitizes pasted terminal controls before filtering.

Search and the viewport affect TUI presentation only. RPC deliberately keeps one flat, unfiltered
list of unique dialog choices, preserving raw identity, disabled rows, toggle semantics, and action
rows without introducing a second query protocol.

```ts
const tools = {
  kind: "multiSelect" as const,
  title: "Tool permissions",
  enableSearch: true,
  viewportSize: 9,
  items: allTools.map((tool) => ({
    id: tool.name, // raw stable identity; never recover it from the display label
    label: tool.name,
    description: tool.description,
    searchText: `${tool.source} ${tool.description}`,
    selected: enabledTools.has(tool.name),
    disabled: blockedTools.has(tool.name),
    disabledReason: blockedTools.has(tool.name) ? "Blocked by the active policy" : undefined,
  })),
  action: "toggleTool" as const,
  actions: [
    // Bulk domain handlers must exclude disabled rows themselves.
    { id: "enable-all", label: "Enable all available", action: "enableAll" as const },
  ],
};
```

Disabled multi-select rows stay visible and focusable, use a textual `[-]`/`unavailable` marker, show
`disabledReason` with the selected description, and never invoke the toggle handler. RPC exposes the
same unavailable reason and safely returns to the screen when the row is selected. Keep policy and
bulk-set validation in the consuming extension and revalidate it again before mutation.

## 🔌 Runtime and mode behavior

`runMenu()` accepts Pi's `ExtensionCommandContext` by default, a definition, and runtime options:

- `getState({ ctx, signal })` loads extension-owned state.
- `signal` aborts state loads and actions immediately when the owning session is replaced or shut down.
- `isCurrent()` prevents stale continuations after session replacement or shutdown.
- `onError(ctx, error)` customizes observable failure reporting.
- `onUnsupportedMode(ctx, mode)` provides print/JSON fallback behavior.

In TUI mode the runtime uses `ctx.ui.custom()`. In RPC mode it adapts standard screens to
`ctx.ui.select()` dialogs. Print and JSON modes never attempt custom UI and instead call the
unsupported-mode hook. `runMenu()` resolves to `closed`, `unsupported`, `stale`, or `error`; only the
`closed` result carries the mandatory interaction-level `reason`.

Lifecycle handlers can opt into the shared `ExtensionContext` surface without a cast. Existing
three-generic command menus keep `ExtensionCommandContext`, including command-only methods.

```ts
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const settledMenu = defineMenu<State, Screen, Action, ExtensionContext>({
  // screens and actions; action ctx is ExtensionContext here
});

pi.on("agent_settled", async (_event, ctx) => {
  const generation = currentGeneration();
  await runMenu(ctx, settledMenu, {
    getState: ({ signal }) => loadState(signal),
    signal: currentSessionSignal(),
    isCurrent: () => generation === currentGeneration(),
  });
});
```

The consumer must own and abort the session signal, check its generation or equivalent identity after
every await, and never retain or use an `ExtensionContext` after session replacement, reload, or
shutdown. The kit does not create lifecycle ownership for the extension. `input` uses a signal-aware
RPC dialog; a multi-line `editor` screen is intentionally deferred because Pi's current RPC editor
contract does not accept an `AbortSignal`.

## 🧩 Ownership boundary

Reuse Pi primitives and domain components from their package root whenever their public contract fits.
Use non-exported Pi composites only as interaction references; never deep-import Pi's `dist/*`
implementation paths. The kit owns a composite only when public controls do not provide the complete
cross-mode and lifecycle contract shared by multiple extensions.

The library owns:

- standalone task-mode adaptation, cancellation, stale checks, error routing, and draining;
- lifecycle ownership, disposal, and pending-work draining around specialized custom interactions;
- width-safe standard rendering and injected keybindings;
- screen-stack navigation, Back/Close semantics, and per-screen cursor memory;
- serial settings and multi-select updates, optimistic rollback, and pending-update draining;
- menu, screen, and busy-action cancellation;
- stale-continuation checks around asynchronous work;
- input draft/pending behavior and exact review formatting, scrolling, and RPC pagination;
- read-only browse search, list/detail disclosure, cursor restoration, and RPC pagination;
- TUI/RPC adaptation and unsupported-mode routing.

The consuming extension still owns:

- domain state, tool activation, commands, and settings schemas;
- transactional persistence and preservation of unknown settings fields;
- confirmations and product-specific copy;
- session generation and shutdown policy supplied through `isCurrent()`;
- multi-line editors, secret inputs, live side-effecting previews, multi-field forms, or other
  specialized custom TUI.

Keep specialized UI local rather than adding package hooks that expose Pi TUI internals.

## 🧪 Supported testing entrypoint

The same npm package exposes test-only drivers from `@narumitw/pi-tui-kit/testing`; there is no
second package to install. Keep production imports on the main entrypoint and import harnesses only
from test code. The testing entrypoint drives Kit behavior through Pi's public custom-factory and RPC
dialog boundaries without returning a raw component or creating a general `ExtensionContext` mock.

Compose `createTuiHarness()` with the consumer's own context fixture:

```ts
import { runMenu } from "@narumitw/pi-tui-kit";
import { createTuiHarness } from "@narumitw/pi-tui-kit/testing";

const tui = createTuiHarness({ width: 80, rows: 24 });
const ctx = {
  ...consumerContext,
  mode: "tui" as const,
  hasUI: true,
  ui: { ...consumerContext.ui, custom: tui.custom },
};

const running = runMenu(ctx, menu, options);
await tui.waitForOpen();
tui.setFocused(true);
tui.type("12");
tui.press("tui.input.submit");
await tui.waitForPending();
tui.resize({ width: 60, rows: 12 });
const frame = tui.render();
const result = await running;
```

The TUI harness supports semantic Kit bindings, explicit raw input, Ctrl+C/Home/End, focus,
invalidation, live width/row changes, render-request observations, pending-action draining,
sequential screens, result observation, and external disposal. `done`, disposal, factory failure,
and obsolete async openings settle exactly once; input after closure is inert. Supply optional
callback-compatible theme/keybinding overrides only when a test needs them.

Use strict scripts for RPC:

```ts
import { createRpcHarness } from "@narumitw/pi-tui-kit/testing";

const rpc = createRpcHarness([
  { kind: "input", title: "Value", placeholder: "", response: "not-a-number" },
  { kind: "input", title: "Value", placeholder: "", response: "12" },
  { kind: "select", options: ["Apply", "Back"], response: "Apply" },
]);
const rpcCtx = {
  ...consumerContext,
  mode: "rpc" as const,
  hasUI: true,
  ui: { ...consumerContext.ui, ...rpc.ui },
};

await runMenu(rpcCtx, menu, options);
rpc.assertConsumed();
```

RPC steps match call kind and optional exact title, placeholder, or choices. Responses are exact raw
strings or `undefined` cancellation; the harness never fuzzy-matches labels. A `waitForAbort: true`
step supports owner-abort tests without a timer. Dialog records are immutable, unexpected or leftover
steps fail observably, and any RPC request for custom TUI throws. The current Kit runtime uses only
signal-aware `input()` and `select()` in RPC, so the testing entrypoint deliberately does not mock
confirmations, editors, notifications, sessions, models, settings, filesystems, clocks, or networks.
Consumer fixtures continue to own domain state, persistence, generation checks, and owner signals.

## 📚 Public API

- `defineMenu()` — validates and returns a typed menu definition.
- `runMenu()` — runs the definition in the current Pi mode and preserves root Back versus Close.
- `runTask()` — runs typed abort-aware work with a cancellable TUI loader and direct non-TUI fallback.
- `runCustomInteraction()` — owns cancellation, stale checks, exactly-once disposal, optional pending
  work draining, and typed results around one extension-owned custom TUI component.
- `resolveMenuScreen()` — resolves and validates a dynamic screen for tests or adapters.
- `createMenuNavigator()` — lower-level stack and selection state helper.
- exported screen, item, action, transition, runtime option, `MenuCloseReason`, and result types.
- `@narumitw/pi-tui-kit/testing` — separate subpath for `createTuiHarness()`, `createRpcHarness()`,
  strict scripts, and their public testing types; it is not re-exported from the production root.
- `PI_EXTENSION_MENU_API_VERSION` — current declarative API version (`6`). Version 6 adds the
  read-only `browse` screen and `runCustomInteraction()`; version-5 definitions remain valid on the
  version-6 runtime, including adaptive review and mandatory Back/Close reasons.

## 🗂️ Package layout

- `src/` — authored TypeScript and the public package entrypoint
- `src/components/` — internal TUI input, review, list, settings, and rendering adapters
- `src/testing/` — supported TUI/RPC test drivers exported only through the `/testing` subpath
- `src/task.ts` — standalone and menu-shared task lifecycle orchestration
- `src/custom-interaction.ts` — lifecycle ownership for specialized public custom components
- `dist/` — generated ESM and declarations included in the npm package
- `test/` — contract, renderer, navigation, lifecycle, and public testing-entrypoint coverage

## 📄 License

MIT © narumiruna
