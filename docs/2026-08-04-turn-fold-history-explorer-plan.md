---
title: Turn Fold history explorer plan
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-08-04
---

# Turn Fold history explorer plan

## Purpose

Turn Fold's full expanded transcript is too slow on large sessions, and changing from a sparse compact transcript to expanded mode requires restarting Pi because omitted transcript components cannot be rebuilt through the public extension API. The replacement must let the user inspect recent full messages inside Pi, load older history when needed, and return to the compact transcript without restarting.

This plan replaces persistent expanded density with a virtualized history explorer. Pi's main transcript remains compact and sparse. `Ctrl+Shift+O` opens and closes an ephemeral, scrollable Pi overlay that starts with the newest three compaction windows and loads three older windows at a time.

## User requirements

- Render history inside Pi rather than in an external pager or terminal process.
- Open and close the detailed view without restarting Pi.
- Start from the newest history and initially admit the latest three compaction windows.
- Load older history in additional bounded chunks.
- Do not require Page Up on macOS.
- Keep editor input responsive on very large sessions.
- Preserve session messages, model context, drafts, cursor state, selection, and undo history.

## Evidence and decision

The large-session fixture contains 3,684 source entries in three compaction windows. Sparse projection reduces that input to 33 displayed entries and about 18 Pi components. Keeping all three windows as native hidden transcript components would therefore undo the bounded-component design and could restore the latency that sparse projection fixed.

The decision is to keep the main transcript compact and use a public `ctx.ui.custom()` overlay. The explorer indexes the active branch once, admits history by compaction-window ranges, and renders only the visible viewport plus a small overscan. The existing compact key-to-echo release limits remain p95 below 50 ms and p99 below 100 ms. A full-resident three-window implementation is not eligible to ship merely because it contains fewer entries than the full branch.

## Public API classification

The documented extension API is sufficient with one limitation.

- `ctx.ui.custom()` with overlay options can host the explorer inside Pi.
- Public Pi TUI `Component`, `Markdown`, `Text`, `matchesKey`, theme, and `tui.requestRender()` APIs can provide rendering and input.
- `ctx.sessionManager.getBranch()` provides the active branch snapshot.
- Pi does not expose a public factory for its built-in transcript components. The explorer will use Turn Fold presenters styled with Pi's public theme rather than import private component classes.

No Pi source change, prototype patch, terminal escape output, or new private integration is allowed.

## Product behavior

### Main transcript

The main transcript is always compact. Remove persistent expanded density and the `compact`, `expanded`, and density-toggle command paths. Existing configuration becomes the strict pair `{ preCompaction, windows }`; old three-field entries are ignored. Main-transcript pre-compaction and window controls remain independent.

`/turn-fold`, `/turn-fold history`, and `Ctrl+Shift+O` open the explorer. The same shortcut, `q`, or `Esc` closes it. The loaded explorer extent and scroll position are process memory only and are discarded on close.

### History range

The explorer reads the complete active branch independently of the main transcript's sparse window selection.

- Initial admitted range: newest three compaction windows.
- Older-history batch: three additional compaction windows.
- Reaching the oldest admitted row and requesting another backward movement admits one older batch.
- The header reports admitted and total windows, such as `3 of 14 windows`.
- Repeated loading can reach the branch root without switching the main transcript to full replay.

### Keyboard controls

- `Up` or `Ctrl+P`: one line backward.
- `Down` or `Ctrl+N`: one line forward.
- `b`: one viewport backward; at the admitted boundary, load an older batch.
- `Space`: one viewport forward.
- `g`: oldest admitted content.
- `G`: newest content.
- `Enter`: expand or collapse the current entry when its preview is truncated.
- `q`, `Esc`, or `Ctrl+Shift+O`: close.

Page Up and Page Down may remain optional synonyms but are not required.

## Architecture

### History index

Add a pure branch index that records entry positions, compaction-window boundaries, total windows, and the start index for any newest-window count. It must not read message bodies. Building the index is one linear pass over branch entry metadata.

### Explorer state

Use a pure state machine for:

- admitted start index;
- current entry and wrapped-line offset;
- viewport movement;
- loading an older window batch;
- newest and oldest jumps;
- entry-detail expansion;
- stable position after range growth and terminal resize.

Positioning uses entry indexes and line offsets, not copied transcript strings.

### Lazy rendering

A presenter converts one entry into a render block only when the viewport reaches it. User and assistant text use the public Markdown renderer. Tool calls, tool results, compactions, run/config entries, custom entries, timestamps, and unknown rows use terminal-safe Turn Fold summaries.

Cache rendered blocks by entry identity, width, theme revision, and detail state. Keep the cache bounded with least-recently-used eviction. Normal rendering returns at most the viewport plus one screen of overscan. Large entries begin with a bounded preview and can be expanded explicitly.

### Overlay lifecycle

The explorer opens only in TUI mode and after Pi becomes idle. During a response, the existing editor wrapper queues one open request until settlement and suppresses duplicates. The wrapper submits `/turn-fold history` without modifying the draft.

A session shutdown or extension reload closes an active explorer and clears its caches. Opening after a branch change takes a new root-to-leaf snapshot. The explorer does not attempt to update beneath an active agent response.

## State and contract impact

- Session state: the explorer appends no entries. Existing Turn Fold run-boundary entries remain unchanged. Explicit main-scope configuration changes continue to append strict configuration entries.
- Model context: unchanged.
- Other persistent data: none.
- Pi internals: no new use. The existing version-locked sparse transcript adapter remains until Pi exposes a public transcript projection API.
- Runtime state: branch index, admitted range, scroll position, detail expansion, and render cache exist only while the explorer is open.

## Scope

### Included

- Hard replacement of expanded density with the explorer.
- Continuous virtual scrolling inside a Pi overlay.
- Lazy older-window admission.
- Mac-accessible keyboard controls.
- Rich public-API rendering for messages and stable summaries for other entries.
- Configuration, command, shortcut, lifecycle, documentation, and test updates.

### Not included

- Changes to Pi source or private native transcript classes.
- Session or model-context rewriting.
- Persisting viewer position or admitted history.
- Exact pixel-for-pixel reproduction of every private Pi transcript renderer.
- Running mutation tests as a normal completion gate.

## Acceptance criteria

- `Ctrl+Shift+O` opens and closes the explorer without changing editor state.
- Opening history never reports `restart required`.
- The explorer initially admits exactly the newest three compaction windows when available.
- Backward movement at the admitted boundary loads exactly three older windows and preserves the visible anchor.
- All history can be reached through repeated bounded loads.
- Only viewport-near entry bodies are read or rendered during open and ordinary movement.
- Theme changes, terminal resizing, unknown entries, control characters, huge messages, and session shutdown are safe.
- Main transcript projection remains compact, bounded, and unchanged outside the intended density removal.
- Normal Pi messages, JSONL, model context, drafts, cursor, selection, and undo history are unchanged.
- Non-TUI modes reject the explorer without installing TUI integration.

## Verification

Run from the repository root:

```bash
npm run check --workspace @onurpi/turn-fold
npm run check
npm run slophammer
git diff --check
```

Also run:

- focused unit tests for indexing, range growth, viewport movement, cache bounds, rendering, and keybindings;
- extension lifecycle and editor-state integration tests;
- an isolated PTY smoke test covering open, scroll, load older, close, reopen, and draft preservation;
- the large-session key-to-echo benchmark with the compact p95 and p99 limits;
- a live Git Attribution session test confirming immediate open/close and backward loading without restart.

After local validation, push the PR head, run Pi Reviewer with GPT-5.6 Terra at high thinking until no P0 or P1 findings remain, resolve PR comments, require green CI, merge, install canonical main, repeat the live smoke test, and remove the task worktree.
