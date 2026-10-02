# context-ceiling

A global context ceiling for Pi. When the session's estimated context passes the ceiling, the
extension asks Pi to compact, so context stays bounded no matter which model is selected — even
models whose real window is far larger.

The ceiling is enabled at 272,000 tokens on every session start. Toggle or retarget it per session
with the `/context-ceiling` command; nothing is written to settings:

- `/context-ceiling` or `/context-ceiling status` — show the current setting
- `/context-ceiling off` — disable for this session
- `/context-ceiling on` — re-enable
- `/context-ceiling 400000` — set a new ceiling (tokens) and enable

## How it works

On `turn_end` and `agent_before_settle`, the extension reads `ctx.getContextUsage()` and requests
`ctx.compact()` when the estimate passes the ceiling. Unknown token counts never trigger, and a
compaction is not re-requested while one is still running; a failed compaction retries on the next
turn. Compaction itself stays Pi's default (or another extension's `session_before_compact`).

This complements the `hf-context-floor` generator script in the repository root: the floor shapes
what small models report, and this ceiling bounds what any model accumulates.
