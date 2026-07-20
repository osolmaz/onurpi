# @onurpi/prompt-queue

Editable prompt queue, steer control, and prompt history manager for the Pi coding agent.

While the agent is running, the extension captures new prompts into its own queue instead of letting
Pi deliver them immediately. Queued items are shown in a list above the prompt editor and can be
edited, reordered, or deleted before they are sent.

## Keys

| Key      | While the agent runs                                   | While idle                  |
| -------- | ------------------------------------------------------ | --------------------------- |
| `Enter`  | Queue the prompt as a follow-up                        | Send the prompt immediately |
| `Tab`    | Queue the prompt as a steering message                 | Default tab behavior        |
| `Up`     | Open the queue and history manager (empty editor only) | Same                        |
| `Alt+Up` | Open the queue and history manager                     | Same                        |

Slash commands (`/…`) and bash directives (`!…`) always go through Pi's own submission path and are
never queued.

## Delivery

- Steering items are injected at the next turn boundary, before the next LLM call.
- Queued follow-ups are sent one at a time whenever the agent settles.
- Delivery pauses while the manager window is open.
- Aborting a run (`Esc`) holds the queue so a stopped run is never restarted silently. Resume it
  explicitly with `r` in the manager window or `/queue resume`, or implicitly by submitting or
  queuing a new prompt. Just opening and closing the manager does not resume.

## Manager window

Open with `Up` (on an empty editor), `Alt+Up`, or `/queue`. It has two tabs: pending queue items and
session prompt history. It opens on the queue tab when anything is pending, otherwise on the history
tab, and jumps to history when the last queue item is deleted.

```text
↑↓ move · ⇥ switch tab · enter to editor · e edit · s steer/queue · x delete · p/n reorder · r resume · esc close
```

- `Tab`, `Left`, or `Right` switches between the queue and history tabs.
- `Enter` inserts the selected text into the prompt editor (queue items are removed from the queue).
- `e` opens Pi's editor dialog to edit the selected queue item or history entry in place.
- `s` toggles the selected queue item between queued and steering delivery.
- `x` deletes the selected item.
- `p` / `n` move a queue item earlier or later. History entries cannot be reordered.
- `r` closes the window and resumes delivery after an interrupt.

History is session-scoped: it is seeded from the current session branch on startup and extended with
every submitted prompt.

## Use during development

From the repository root:

```bash
npm install
pi -e ./packages/prompt-queue/index.ts
```

The package is private and is not published yet.

## Current implementation boundary

Pi does not let extensions edit its internal steering and follow-up queues, so this extension keeps
its own queue and only hands a message to Pi at the moment it should be delivered
(`pi.sendUserMessage`). Messages queued through Pi's built-in `Alt+Enter` bypass this extension's
queue. The custom editor targets Pi 0.80.10 or newer and must be retested when Pi changes its
interactive editor wiring.

## Quality checks

```bash
npm run check
npm run mutate
npm run slophammer
```
