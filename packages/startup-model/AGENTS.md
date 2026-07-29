# @onurpi/startup-model

- Use only documented Pi extension hooks and exported public APIs.
- Enforce the configured model only for `session_start` events whose reason is `startup`.
- Leave model changes in the active process alone, including reload and in-process session changes.
- Compare the active provider and model ID before selecting so Pi does not write duplicate state.
- Keep the configured provider and model ID in one reviewed constant.
- Do not edit Pi settings, append custom session entries, add sidecar state, or use Pi internals.
- Report missing models and authentication through Pi's notification API.
- Add or update tests for every behavior change.
- Before finishing, run `npm run check`, `npm run slophammer`, and `git diff --check`.
- Keep mutation-testing scripts available, but run them only when explicitly requested or when
  investigating test-suite strength.
