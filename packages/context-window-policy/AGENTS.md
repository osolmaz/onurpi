# @onurpi/context-window-policy

- Use only documented Pi extension hooks and exported public APIs. Do not patch Pi internals, mutate
  settings at runtime, or write session entries directly.
- Keep model-relative threshold calculation and trigger-state transitions separate from Pi event
  wiring.
- Use the active model's context window and Pi's current context-usage API; pass through when either
  value is unavailable or invalid.
- Keep Pi's built-in compaction enabled as a fallback and let Pi generate its normal summary and
  compaction entry.
- Call Pi's aborting manual compaction API only after `agent_settled` or during an idle model
  change; never interrupt an active tool continuation.
- Keep duplicate-prevention state ephemeral and session-scoped.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
