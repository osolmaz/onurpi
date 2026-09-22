# @onurpi/context-budget

- Keep measurement and message building pure in `context-budget.ts`. Only `index.ts` touches Pi
  APIs.
- Use only documented Pi behavior: the `session_start`, `before_agent_start`,
  `before_provider_request`, and `session_shutdown` hooks, `ctx.getSystemPrompt()`,
  `pi.getAllTools()`, `pi.getActiveTools()`, `ctx.getContextUsage()`, and the `notify`, `setStatus`,
  and `setWidget` UI methods. Do not patch Pi internals.
- Never write session entries. This extension reports the beginning context; it does not change the
  prompt, the tool set, or the transcript.
- Keep the config file tolerant: a missing or broken file must fall back to defaults and report the
  problem instead of stopping a session.
- Do not add runtime dependencies. Node built-ins cover the rest.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
