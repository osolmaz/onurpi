# @onurpi/codex-switcher

- Keep one provider ID, `openai-codex`. Account identity must never become provider identity.
- Keep account credentials in the protected switcher vault. Never read Codex CLI credentials or log,
  persist elsewhere, or snapshot tokens, account IDs, credential hashes, or auth contents.
- Send credentials only to the exact official ChatGPT Codex, usage, and OAuth endpoints.
- Treat `billing: allow-credits` as the required configuration permission for paid credits.
- Fall back only for confirmed subscription or credit exhaustion before semantic output starts.
- Never fall back after text, thinking, or a tool call starts.
- Keep the committed account fixed through the complete agent run.
- Use only documented Pi provider, auth, model, command, event, and status APIs.
- Add or update tests for every behavior change.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
