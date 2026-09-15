---
title: Add the prompt-queue duplicate key
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-09-15
tags: [pi, prompt-queue, manager-window, extensions]
---

# Add the prompt-queue duplicate key

## Purpose

The prompt-queue manager window can edit, retag, reorder, delete, send, or insert a prompt. It
cannot duplicate one.

OnurPi needs a `c` key that duplicates the selected row. With the window open on the queue tab, one
press creates a second entry with the same text and the same delivery mode directly after the
source, and the cursor lands on the copy. On the history tab, the same press creates a queued
follow-up with that text, switches to the queue tab, and puts the cursor on the new item.

The mode rule is part of the request. A `steer` item stays `steer`, a `queue` item stays `queue`,
and a duplicate taken from a history entry joins the queue as a follow-up.

The hint line and the package README must document the action. Every existing key keeps its meaning.
Delivery behaviour must not change. The queue, history, and window state modules must stay pure and
fully unit-tested.

## Selected design

The change is three small pieces, one per layer that already owns the rule. The mutation happens
inside the open window exactly like delete, mode toggle, and reorder.

### Placement, fresh ids, and the mode copy

`packages/prompt-queue/queue-model.ts` gains `duplicate(id: number): QueueItem | undefined` in the
`PromptQueue` class, next to `toggleMode` and `remove`.

It finds the source with `indexOf` and returns `undefined` when the id is unknown, which changes
nothing. Otherwise it builds `{ id: this.nextId, mode: source.mode, text: source.text }`, increments
the counter, splices the copy in at the source index plus one, and returns the copy. The id comes
from the same counter that `add` uses. Every other method stays untouched, so the copy behaves as an
ordinary item.

### Cursor and tab

`packages/prompt-queue/window-state.ts` gains `duplicateSelected(): boolean` in the
`ManagerWindowState` class, next to `deleteSelected`.

It reads `selection()` and returns `false` when there is none. For a queue target it calls
`queue.duplicate(id)`, returns `false` when that returns `undefined`, and sets the cursor from
`entries()` by finding the entry whose target id equals the copy id. For a history target it calls
`queue.add(entry.text, "queue")`, switches the tab to the queue, and sets the cursor the same way
from the new item's id. The source item is not touched.

### Key and hint line

`packages/prompt-queue/manager-window.ts` binds the key and advertises it.

In `handleKey`, `else if (data === "c") this.state.duplicateSelected();` sits beside the `m`, `d`,
`p`, and `n` branches, after the special-key and finish-key handlers, so the existing precedence is
preserved. The `HINT` string gains `c copy` directly after `d delete`.

### Documentation

`packages/prompt-queue/README.md` gains `c copy` on the manager window shortcut line and a bullet
that states the mode rule and the placement rule. The Keys table and every other section stay
unchanged.

`AGENTS.md` is not changed, because the existing purity and delivery rules already cover the new
behaviour.

## Contracts

- `PromptQueue.duplicate(id: number): QueueItem | undefined` inserts a copy directly after its
  source with the same `mode` and the same `text`, takes a fresh id from the same counter that `add`
  uses, and returns the copy. An unknown id returns `undefined` and changes nothing.
- `ManagerWindowState.duplicateSelected(): boolean` duplicates the selected queue item and moves the
  cursor onto the copy. On the history tab it adds the selected text to the queue with mode `queue`,
  switches the tab to the queue, and moves the cursor onto the new item. It returns `false` when
  there is no selection.
- The manager gains key `c`, and the hint line gains `c copy`. Every existing key keeps its meaning,
  and no existing key is rebound.
- `ManagerResult` is unchanged and `index.ts` is unchanged, because the mutation happens inside the
  open window exactly like delete, mode toggle, and reorder. No new result kind, no new command, and
  no new subcommand.
- `QueueItem` and `PromptHistory` keep their current shape. No new field, no new schema, no settings
  key, and no compatibility path. The current version identifiers stay.
- Delivery behaviour is untouched. The window still pauses delivery, an abort still holds the queue,
  and only `r` in the manager or `/queue resume` resumes it.
- `README.md` documents the key, the mode rule, and the placement rule.

## Boundaries

This work does not touch:

- Pi core, Pi's internal steering and follow-up queues, Pi's built-in Alt+Enter path, the TUI key
  routing, the pi-ai registry, or provider composition;
- delivery policy, which covers when a steer item is injected, when a follow-up is sent, the hold
  after an abort, and the resume rules;
- any existing manager key or command meaning, or the text of the other hint entries;
- any other package in the repository, any other repository, credentials, OAuth, the auth store,
  releases, or deployment;
- the shape of `QueueItem` and `PromptHistory`, and any persisted schema, settings key, or
  compatibility path for older state.

Duplicating a prompt that Pi queued itself, a message already sent in the session, or the editor
draft stays out of reach, because this extension sees only its own queue and a flat history of
strings.

The package stays private. The alpha policy applies, so contracts change in place, the current
version identifiers stay, and the change adds no compatibility shim, dual path, alias, or feature
flag.

## Risks and mitigations

- A duplicated steering item is a real steering item, so it can be delivered at the next turn
  boundary before the user finishes editing it. The README states that a copy is a real queue item,
  the copy is visible and selected so it can be deleted with `d` or retargeted with `m`, and the
  window pauses delivery while it is open.
- The cursor can land on the wrong row when the index is computed by arithmetic after the splice.
  The cursor is computed from the new item's id through `entries()` instead of adding one to the old
  index, and the tests cover a duplicate in the middle, at the end, and on a one-item queue.
- `c` may collide with a Pi editor binding or a user habit. `c` is unbound in this window today, the
  hint line advertises it, and the key is a one-line change if it collides later.
- Duplicating a history entry adds a prompt the user did not type, which could be delivered later.
  The window pauses delivery while it is open, the tab switches to the queue so the new item is
  visible, and the README states the rule.
- The package enforces an 85 percent coverage threshold on the pure modules, so an untested branch
  fails the check. Every branch of both new methods is covered, including the no-selection,
  unknown-id, and empty-list paths, and the existing tests stay unchanged.
- Adding a key to a key map can silently break another key's routing. One test presses every bound
  key in turn and asserts its effect, and the existing test that leaves `x` unbound stays as the
  pattern for proving which keys are free.

## Implementation steps

1. Add `duplicate(id: number): QueueItem | undefined` to `PromptQueue` in
   `packages/prompt-queue/queue-model.ts`, next to `toggleMode` and `remove`.
2. Add `duplicateSelected(): boolean` to `ManagerWindowState` in
   `packages/prompt-queue/window-state.ts`, next to `deleteSelected`.
3. Bind `c` in `handleKey` and add `c copy` to the `HINT` constant in
   `packages/prompt-queue/manager-window.ts`.
4. Document the key, the mode rule, and the placement rule in `packages/prompt-queue/README.md`.
5. Run the package and repository gates.
6. Land the change the way the repository requires, with one branch, one pull request, one Pi
   Reviewer round against `main`, and green CI. Merge by rebase after CI is green, then delete the
   branch.
7. Verify the behaviour by hand in a live Pi session that loads the package.

## Tests

- `queue-model.test.ts`: a copy lands directly after its source with the same text and mode, and
  gets a fresh id from the same counter.
- `queue-model.test.ts`: a steer source yields a steer copy, a queue source yields a queue copy, and
  the source keeps its position, mode, and text.
- `queue-model.test.ts`: an unknown id returns `undefined` and leaves the list unchanged, and
  duplicating the last item lands at the end.
- `window-state.test.ts`: on the queue tab the cursor moves onto the copy and the source is
  untouched.
- `window-state.test.ts`: on the history tab one queue item is added with mode `queue`, the tab
  becomes `queue`, and the cursor moves onto the new item.
- `window-state.test.ts`: with no selection the method returns `false` and neither model changes.
- `manager-window.test.ts`: `c` duplicates the selection and requests a render, and a companion
  assertion pins `c` as bound while `x` stays unbound.
- `manager-window.test.ts`: the rendered hint line contains `c copy`, and the `m`, `d`, `s`, `e`,
  `r`, `p`, `n`, enter, escape, tab, and arrow tests keep their current expectations.
- The whole existing suite passes unchanged, so no earlier test is weakened to make room for the new
  one.

Automated tests must not write outside temporary directories, call real models, or need the network.

## Verification

Run the package gates:

```sh
npm run check --workspace @onurpi/prompt-queue
npm run slophammer --workspace @onurpi/prompt-queue
```

Run the repository gates:

```sh
npx --no-install vitest run packages/package-loading.test.ts
npx slophammer-ts check . --only ts.dependency-boundaries-required
git diff --check
```

Then verify the behaviour by hand in a live Pi session that loads the package. Open the manager
window, duplicate a queued item and a steering item, then duplicate a history entry. A copy must
appear directly under its source with the same `[steer]` or `[queued]` badge, and the cursor must
sit on it. The history case must land on the queue tab with a new queued item. Delivery must stay
paused while the window is open, and the other keys must still do what they did before.

The repository root check currently fails on an unrelated lint error in
`packages/agents/skills/demo-video/reference/render.mjs`, which is missing from the eslint
`allowDefaultProject` list. That failure is pre-existing and outside this work.

## Pi contract impact

- **Session state:** No entry is appended and no existing entry is changed.
- **Persistent data:** No settings key, schema, or state file is added or changed.
- **Pi internals:** None.
- **Public API:** The manager window uses the same TUI key handling it already uses. No new Pi API
  is introduced.

## Exclusions

This work does not include:

- changes to Pi core or to Pi's internal queues;
- changes to delivery policy or to the resume rules;
- rebinding or redefining an existing manager key;
- duplicating a message that Pi queued itself, a message already sent in the session, or the editor
  draft;
- changes to the shape of `QueueItem` or `PromptHistory`;
- releases or deployment.
