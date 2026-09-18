# @onurpi/session-policy

- Keep policy decisions pure and separate from Pi event wiring. `marker.ts`, `cache.ts`,
  `config.ts`, `policy.ts`, and `command.ts` must not call Pi APIs.
- Keep `session.ts` free of Pi runtime calls. It receives content, messages, and contexts from the
  hooks in `index.ts`.
- Use only documented Pi behavior: the `tool_result`, `context`, `session_compact`, `session_tree`,
  `session_start`, and `session_shutdown` hooks, `resizeImage`, `sessionEntryToContextMessages`, and
  the session and command contexts. Do not patch Pi internals or write session entries directly.
- Never mutate the messages the `context` hook receives. Re-attach happens on the copy Pi hands to
  the hook, and the session file is never rewritten.
- Keep the cache in process memory only. Do not add a disk spool, sidecar store, or cache file.
- Keep the config file tolerant: a missing or broken file must fall back to defaults and report the
  problem instead of stopping a session.
- Do not add runtime dependencies. Pi exports the image resize helper and the session projections,
  and the standard library covers the rest.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
