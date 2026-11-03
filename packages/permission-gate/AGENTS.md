# @onurpi/permission-gate

- Keep policy pure. `src/policy.ts`, `src/gate-state.ts`, `src/summary.ts`, and `src/command.ts`
  must not call Pi APIs.
- Use only documented Pi behavior: the `tool_call` hook, `registerCommand`, `getAllTools`, and
  `ctx.ui.select` and `ctx.ui.notify`. Do not patch Pi internals.
- Fail closed. A gated call with no interactive UI, a dismissed dialog, an aborted dialog, or an
  unknown answer must block and tell the model why.
- Keep the state in process memory and keep it to the on or off switch. Do not add a per-tool
  allowlist, an approval cache, a session entry, a status line, a widget, a footer, a header, or a
  file. An approval covers one call, so a hidden tail of a script can never ride on it.
- Show the real input in the dialog. Escape hidden characters before truncating, and mark a cut
  value.
- Do not add runtime dependencies.
- Run `npm run check` and `npm run slophammer` before finishing.
