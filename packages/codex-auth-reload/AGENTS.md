# @onurpi/codex-auth-reload

- Read Codex credentials only from `${CODEX_HOME:-~/.codex}/auth.json`; never copy them to Pi's
  credential store.
- Never log, persist, snapshot, or include tokens, account IDs, file contents, or credential hashes
  in messages.
- Reload only immediately before built-in `openai-codex` provider dispatch.
- Never read or apply the Codex CLI credential for a custom endpoint; require the exact official
  Codex base URL.
- Require the Codex file and Pi's resolved request auth to identify the same account.
- Keep Pi's original auth on every validation, expiry, I/O, or account-identity failure.
- Use only documented Pi provider registration and public exports. Do not patch Pi internals.
- Add or update tests for every behavior change.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
