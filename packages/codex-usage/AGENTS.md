# @onurpi/codex-usage

- Publish compact weekly usage only while the active provider is `openai-codex`; clear it on model
  changes and session shutdown.
- Keep automatic refreshes timer-free, quiet on failure, and limited by the shared five-minute
  in-memory cache.
- Keep `/codex-status` available for explicit full reports and refreshes.
- Use only Pi's public model registry for subscription authentication.
- Keep network access restricted to the fixed Codex usage endpoint.
- Keep the Codex app-server fallback shell-free, timeout-bounded, and scoped to one query.
- Do not write session entries, messages, settings, files, credentials, or other persistent state.
- Treat all provider and app-server payloads as untrusted input.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
