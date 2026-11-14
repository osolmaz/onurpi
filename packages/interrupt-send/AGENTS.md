# Interrupt Send

- Reach the live `InteractiveMode` only through the wrapped prototype methods in `capture.ts`, and
  read its fields with `Reflect`. Do not change Pi core.
- Never submit while the session is streaming or compacting: abort first, then submit through
  `defaultEditor.onSubmit` so commands, templates, and history behave as usual.
- Keep the queue arithmetic pure and tested: steering messages come before follow-ups, and the
  message that leaves the queue is the one that gets sent.
- Restore every wrapped method at `session_shutdown`, and only when the current value is still the
  wrapper this extension installed.
- Keep the shortcut description short and honest: it interrupts, it does not queue.
