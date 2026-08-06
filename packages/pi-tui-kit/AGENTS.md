# @onurpi/pi-tui-kit

- This is a library package, not a Pi extension. Do not add a `pi` manifest section or register it
  as a Pi resource.
- Keep the public API surface identical to upstream: production exports from `src/index.ts`, test
  drivers only from `src/testing/`.
- Preserve upstream menu, task, and interaction lifecycle semantics exactly: typed results, stale
  classification, exactly-once disposal, and abort draining.
- Do not add explicit `any`, unsafe casts, network access, process execution, telemetry, credential
  access, or background persistence.
- Audited upstream routines keep line-level, justified complexity and length suppressions; do not
  add new suppressions without equivalent evidence.
- Keep the upstream tests close to the `node:test` originals (only the runner import and harness
  paths were adapted) so regraft updates stay mechanical.
- Preserve the upstream MIT license and update `UPSTREAM.md` when importing upstream changes.
- `highlight.js` is the single allowed runtime dependency; do not add more.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
