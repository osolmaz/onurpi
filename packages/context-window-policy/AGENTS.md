# @onurpi/context-window-policy

- Use only documented Pi extension hooks and exported public APIs. Do not patch Pi internals, mutate
  settings at runtime, or write session entries directly.
- Keep model-relative threshold calculation and lifecycle state separate from Pi event wiring.
- Use the active model's context window and Pi's current context-usage API. Pass through when either
  value is unavailable or invalid.
- Own compaction timing only. `@onurpi/pi-codex-compaction` owns native Codex checkpoint content and
  its branch fence.
- Interrupt only a completed tool turn. Wait for `agent_settled` before calling `ctx.compact()`.
- Do not interrupt a final assistant turn. Compact it after settlement without starting another
  model turn.
- Keep Pi's built-in threshold and overflow compaction enabled as fallbacks. Do not duplicate a
  successful built-in compaction or its retry.
- Continue an interrupted run at most once, and only after successful compaction. Use one hidden
  custom message through `pi.sendMessage()` and suppress it when Pi already has queued work.
- Keep duplicate-prevention state ephemeral and session-scoped. Clear stale callbacks at session and
  model lifecycle boundaries.
- Add or update tests for every behavior change.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
