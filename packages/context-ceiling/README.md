# context-ceiling

A global context ceiling for Pi. When the session's estimated context passes the ceiling, Pi
compacts, so context stays bounded no matter which model is selected — even models whose real window
is far larger.

## Requirements

These are the governing contract for this package. Changes must keep all three.

1. **Compact at the limit, mid-run included.** When the context passes the ceiling, compaction
   happens at the next tool-batch boundary inside the running turn. A turn may never run on
   indefinitely past the ceiling; the settle-time compaction is a fallback, never the primary
   mechanism.
2. **Global and programmatic.** The ceiling applies to whichever model is selected and is derived at
   runtime from the active model. There is no per-model list of overrides to maintain.
3. **Hard bound.** Once enabled, the ceiling bounds context for every model until it is turned off.
   Retargeting re-derives the cap; nothing accumulates stale state.

The ceiling is enabled at 272,000 tokens on every session start. Toggle or retarget it per session
with the `/context-ceiling` command; nothing is written to settings:

- `/context-ceiling` or `/context-ceiling status` — show the current setting
- `/context-ceiling off` — disable for this session
- `/context-ceiling on` — re-enable
- `/context-ceiling 400000` — set a new ceiling (tokens) and enable

## How it works

**Primary mechanism: the effective context-window cap.** On `session_start` and `model_select`, the
extension re-registers the selected model's provider through Pi's public `registerProvider` API with
a cloned model list in which every chat model's `contextWindow` is capped at
`ceiling + reserveTokens` (272,000 + 16,384 = 288,384 by default). It then re-applies the selection
with `setModel` so the running session picks up the capped window. Pi's own automatic compaction
triggers when the projected context passes `contextWindow - reserveTokens` — that threshold now
lands exactly on the ceiling, and Pi checks it mid-run between tool batches. The turn keeps running
across the compaction; nothing is aborted. If one tool batch overshoots anyway (a single huge tool
result), Pi's compact-and-retry overflow recovery covers it.

**Fallback: settle-time compaction.** On `turn_end`, `agent_before_settle`, and `agent_settled`, the
extension reads `ctx.getContextUsage()` and reacts to the estimate passing the ceiling. While the
session is busy it only sets a footer status (`compacting when the run settles`); it never calls
`ctx.compact()` mid-run, because that aborts the active run. Once the session has settled and is
still over the ceiling, it waits one macrotask so continuations that other extensions queue at
settle can start first, then compacts only if the session is still idle.

Details:

- The cap derives from the live registry at runtime; there is no per-model list to maintain.
- Caps are re-derived from the original capture, so retargeting up or down cannot stack.
- `/context-ceiling off` unwinds every cap: prior extension-registered provider configs are
  restored, otherwise the provider is unregistered so built-in and models.json models return, and
  the selection is re-applied with the original window.
- The reserve is Pi's default `compaction.reserveTokens` (16384). If you raise Pi's setting, the
  trigger lands below the ceiling — it compacts earlier, never later.
- An explicit `modelOverrides.contextWindow` in models.json wins over the cap for that model.
- Registrations are in-memory only; nothing is written to settings or session storage.
- Compaction itself stays Pi's default (or another extension's `session_before_compact`).

This complements the `hf-context-floor` generator script in the repository root: the floor shapes
what small models report, and this ceiling bounds what any model accumulates.
