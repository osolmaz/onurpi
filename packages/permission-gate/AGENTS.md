# @onurpi/permission-gate

- Keep policy pure. `src/policy.ts`, `src/gate-state.ts`, `src/summary.ts`, `src/command.ts`, and
  `src/approval.ts` must not call Pi APIs. `src/approval.ts` renders only what it is given.
- Use only documented Pi behavior: the `tool_call` hook, `registerCommand`, `getAllTools`,
  `ctx.ui.custom` with the injected `tui`, `theme`, and `keybindings` arguments, `ctx.ui.select`,
  and `ctx.ui.notify`. Do not patch Pi internals.
- Keep the gate off at startup. Only `/gate on`, the environment variable, or a command turns it on.
- Fail closed once the gate is on. A gated call with no interactive UI, a dismissed or aborted
  dialog, or an unknown answer must block and tell the model why.
- Keep approvals to one call. Do not add a per-tool allowlist, an approval cache, a session entry, a
  status line, a widget, a footer, a header, or a file, so a hidden tail or a nested script can
  never ride on an earlier approval.
- Show the real input in the dialog: every field, hidden characters escaped, base64 and session
  escapes decoded, and a cut marked with the number of characters it hides.
- Accept only dedicated keys for an answer. Enter and stray text must never approve a call. Keep the
  typed-ahead guard, restart it after every key, and show one dialog at a time.
- Do not add runtime dependencies. `@earendil-works/pi-tui` is a peer dependency.
- Run `npm run check` and `npm run slophammer` before finishing.
