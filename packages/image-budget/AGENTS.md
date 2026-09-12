# @onurpi/image-budget

- Keep policy decisions pure and separate from Pi event wiring. `image-budget.ts`, `config.ts`,
  `context-policy.ts`, `result-policy.ts`, and `command.ts` must not call Pi APIs.
- Use only documented Pi behavior: the `tool_result` and `context` hooks, `resizeImage`, and the
  session and command contexts. Do not patch Pi internals or write session entries directly.
- Keep the `context` hook non-destructive to the session file. Redaction happens on the copy Pi
  hands to the hook, never on stored history.
- Keep the config file tolerant: a missing or broken file must fall back to defaults and report the
  problem instead of stopping a session.
- Do not add runtime dependencies. Pi exports the image resize helper, and the standard library
  covers the rest.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
