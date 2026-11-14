# @onurpi/interrupt-send

Ctrl+Enter sends now instead of waiting.

- With text in the editor, it stops the running turn and submits that text at once.
- With an empty editor, it takes the oldest queued message, stops the running turn, and submits that
  message. Repeated presses drain the queue one message at a time, steering messages before
  follow-ups.

`ctrl+enter` arrives as its own key only when the terminal reports it (Kitty keyboard protocol).
Otherwise the terminal sends a plain Enter and Pi submits normally.

## How it works

Pi exposes extension shortcuts, but not the editor, the session queue, or the submit path. The
extension therefore patches the `InteractiveMode` prototype to keep the live instance:

1. `capture.ts` wraps `handleEvent`, `showStatus`, and `updatePendingMessagesDisplay`. The first one
   that runs records the instance.
2. `pi.registerShortcut("ctrl+enter", ...)` fires before the editor handles the key.
3. `interrupt.ts` reads the editor text, else takes one queued message, aborts the running turn, and
   submits through `defaultEditor.onSubmit`, the same path a typed prompt uses.
4. `queue.ts` rebuilds the queue without the message it took, because Pi has no queue pop.

`session_shutdown` restores the prototype.

## Limits

- A re-queued message can expand a prompt template again. A failed re-queue is dropped; the taken
  message is never lost.
- The shortcut does nothing until an interactive mode has been seen, and it is inert in non-TUI
  modes.
- Only TUI shortcuts are registered. RPC and headless runs are unchanged.

## Development

```sh
npm run check --workspace=@onurpi/interrupt-send
```
