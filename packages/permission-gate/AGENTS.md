# @onurpi/permission-gate

- Keep policy pure. `src/policy.ts`, `src/gate-state.ts`, `src/summary.ts`, and `src/command.ts`
  must not call Pi APIs.
- Use only documented Pi behavior: the `tool_call`, `session_start`, `session_before_switch`, and
  `session_before_fork` hooks, `registerCommand`, `getAllTools`, and `ctx.ui.select` and
  `ctx.ui.notify`. Do not patch Pi internals.
- Fail closed. A gated call with no interactive UI, a dismissed dialog, or an unknown answer must
  block and tell the model why.
- Keep the state in process memory. Do not write a session entry, a status line, a widget, a footer,
  a header, or a file. The status-line test in `index.test.ts` enforces the interface rule.
- Do not add runtime dependencies.
- Run `npm run check` and `npm run slophammer` before finishing.
