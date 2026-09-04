# @onurpi/codex-switcher

- Keep one provider ID, `openai-codex`. Account identity must never become provider identity.
- Keep account credentials in the protected switcher vault. Never read Codex CLI credentials or log,
  persist elsewhere, or snapshot tokens, account IDs, credential hashes, or auth contents.
- Send credentials only to the exact official ChatGPT Codex, usage, and OAuth endpoints.
- Treat `billing: allow-credits` as the required configuration permission for paid credits.
- Fall back only for confirmed subscription or credit exhaustion before semantic output starts.
- Never fall back after text, thinking, or a tool call starts.
- Keep the committed account fixed through the complete agent run.
- Use documented Pi provider, auth, model, command, event, and status APIs except for the reviewed
  Pi 0.84.x and 0.85.x startup adapter. That adapter may wrap only the public exported
  `ModelRuntime.prototype.hasConfiguredAuth` method during saved-model restoration. It must be
  version-locked, reversible, guarded against duplicate installation, and removed when Pi registers
  providers before model restoration.
- The startup adapter may report `openai-codex` readiness only when valid switcher configuration has
  a matching account in the existing protected vault. It must delegate all other providers and
  states, return no credential data, make no session or model change, and restore Pi's exact
  original method on every cleanup path.
- Add or update tests for every behavior change.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
