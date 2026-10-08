# @onurpi/context-ceiling

- Keep ceiling state and trigger policy in `ceiling.ts`, free of the extension API, so the state
  machine stays testable without Pi.
- Never interrupt a busy session: `ctx.compact()` aborts an active run, so a sample over the ceiling
  while the session is busy only shows a status line, and the compaction happens once the session
  has settled.
- Compact only after the deferred macrotask re-checks idleness, so continuations other extensions
  queue at settle start first.
- Keep compaction outcomes ephemeral: reset `compactionInFlight` on completion and on error, and
  never persist ceiling state to settings or session storage.
- `/context-ceiling` toggles and retargets the in-memory state only; it must not read or write
  tracked settings.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
