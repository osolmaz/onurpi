# AGENTS.md

Package rules for `@onurpi/focus-mode`.

- Keep `gate.ts` and `converge.ts` pure. They take their input as arguments and touch no file system
  and no Pi object, so the rules stay directly testable.
- Keep every lease write atomic. A claim is one exclusive create, so two sessions can never hold the
  same slot and a crash can never leave a half-written lease.
- Never send a signal to another process. Liveness uses `/proc/<pid>` with a `process.kill(pid, 0)`
  fallback that sends nothing, and an over-cap stop asks the victim to call `ctx.abort()` in its own
  session.
- Fail open. Every handler catches its own errors, notifies once per session, and lets the prompt
  through, because a broken store must never trap the user's work.
- Write only these user state paths: `~/.pi/agent/focus-mode.json` and
  `~/.pi/agent/focus-mode/leases/`. Never write into Pi's session file, session state directory, or
  any other package's state.
- Use only documented Pi extension interfaces. No Pi core change, no private API, no monkey patch.
- Run `npm run check` and `npm run slophammer` before committing. Both must pass.
- The plan for this package is `docs/2026-09-21-focus-mode-plan.md` in the repository root. Update
  it when behaviour changes, and record meaningful departures from it.
