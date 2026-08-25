# OnurPi

- This public repository contains public personal agent skills and the shared agent installer under
  `packages/agents`.
- Private global instructions, private skills, and private control-plane configuration live outside
  this repository. Do not copy their content, repository names, identifiers, or local paths into
  OnurPi.
- Read the installed Pi documentation and relevant examples completely before changing an extension.
- Keep each extension independent under `packages/<name>/` with a Pi manifest, entry point, tests,
  and README; also register development entry points in the root Pi manifest.
- Follow `docs/adding-packages.md` for package adoption. Root Pi resources must point into
  `packages/<name>` and must never load extension entry points directly from root `node_modules`.
- Keep wrapper packages private unless the user separately approves an npm release.
- For a simple package version update that only adopts an already reviewed and tested upstream
  release, run the relevant local checks, then commit and push directly to `main`. Do not create a
  pull request or run Pi Reviewer unless the user asks or repository rules require it.
- Use strict TypeScript. Do not use explicit `any`, unsafe casts, or unchecked external input.
- Keep only reviewed global settings in `settings.json`. Never copy Pi authentication, sessions,
  trust decisions, or provider state into this repository.
- Never edit the tracked `settings.json` by hand; write it with `npm run settings:sync`. The live
  `~/.pi/agent/settings.json` may be edited directly when needed (for example to point an entry at a
  worktree during development); `npm run settings:reset` normalizes it back. Both scripts replace
  repo-owned entries (checkout paths, worktree paths, the git source) with canonical per-package
  paths derived from the Pi resources in the root manifest.
- Keep transcript selection and folding policy separate from Pi TUI patching and other runtime
  integration.
- Add or update tests for every behavior change.
- Avoid new runtime dependencies when the standard library or Pi APIs suffice.
- Follow `VENDORING.md` when adopting third-party extensions. Vendor small, low-traction extensions
  before installing them.
- Before finishing, run `npm run check`, `npm run slophammer`, and `git diff --check`.
- Keep mutation-testing scripts available, but do not run mutation tests as part of normal checks,
  CI, review, or task completion. Run them only when a user explicitly requests them or when
  manually investigating test-suite strength.
- Slophammer guidance: https://github.com/osolmaz/slophammer/blob/main/docs/AGENT_ENTRYPOINT.md

## Alpha compatibility policy

OnurPi is in alpha. Until the repository explicitly leaves alpha:

- Do not preserve backward compatibility unless the user explicitly requires it for a task.
- Change persisted schemas and public contracts in place. Keep their current version identifiers.
- Do not add `v2` schemas, compatibility readers, migration shims, dual reads, dual writes, aliases,
  deprecated paths, or feature flags only to support older alpha state.
- Remove the superseded implementation in the same change.
- If old local state is incompatible, fail with a clear reset instruction. Do not silently
  reinterpret or delete that state.
