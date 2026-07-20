# @onurpi/prompt-queue

- Keep queue, history, and policy modules pure and fully unit-tested; only `index.ts`,
  `queue-editor.ts`, and `manager-window.ts` may touch Pi or TUI APIs.
- Never deliver queued messages while the manager window is open or after an abort until the user
  explicitly resumes (`r` in the manager, `/queue resume`) or submits a new prompt. Closing the
  manager window alone must not resume delivery.
- Slash commands and bash directives must always pass through Pi's own submission path.
- Retest the editor subclass against each supported Pi release.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
