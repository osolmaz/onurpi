# OnurPi

- Read the installed Pi documentation and relevant examples completely before changing an extension.
- Keep each extension independent under `packages/<name>/` with a Pi manifest, entry point, tests,
  and README; also register development entry points in the root Pi manifest.
- Use strict TypeScript. Do not use explicit `any`, unsafe casts, or unchecked external input.
- Keep only reviewed global settings in `settings.json`. Never copy Pi authentication, sessions,
  trust decisions, or provider state into this repository.
- Never edit the tracked `settings.json` by hand; write it with `npm run settings:sync`. The live
  `~/.pi/agent/settings.json` may be edited directly when needed (for example to point an entry at a
  worktree during development); `npm run settings:reset` normalizes it back. Both scripts replace
  repo-owned entries (checkout paths, worktree paths, the git source) with canonical per-package
  paths derived from `pi.extensions` in the root manifest.
- Keep transcript selection and folding policy separate from Pi TUI patching and other runtime
  integration.
- Add or update tests for every behavior change.
- Avoid new runtime dependencies when the standard library or Pi APIs suffice.
- Follow `VENDORING.md` when adopting third-party extensions. Vendor small, low-traction extensions
  before installing them.
- Before finishing, run `npm run check`, `npm run mutate`, `npm run slophammer`, and
  `git diff --check`.
- Slophammer guidance: https://github.com/dutifuldev/slophammer/blob/main/docs/AGENT_ENTRYPOINT.md
