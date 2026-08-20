# @onurpi/codex-switcher

- Keep account credentials in Pi's existing provider auth store. Never read, copy, log, persist, or
  snapshot tokens, account IDs, credential hashes, or auth file contents.
- Send credentials only to the exact official ChatGPT Codex endpoint and usage endpoint.
- Treat `billing: allow-credits` as the required configuration permission for paid credits.
- Fall back only for confirmed subscription or credit exhaustion before semantic output starts.
- Never fall back after text, thinking, or a tool call starts.
- Use only documented Pi provider, auth, model, command, event, and status APIs.
- Add or update tests for every behavior change.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
