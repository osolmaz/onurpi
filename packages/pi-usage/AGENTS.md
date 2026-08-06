# @onurpi/pi-usage

- Publish the compact `usage` status only for the selected model's provider; clear it on model
  changes to unsupported providers and on session shutdown.
- Keep the status path timer-free: refresh from Pi lifecycle hooks (`session_start`, `session_tree`,
  `model_select`, `turn_start`) and `/usage` menu actions only. The five-minute in-memory cache
  bounds query frequency; do not reintroduce polling timers.
- Keep `/usage` argument-free; cross-provider queries stay explicit interactive menu choices.
- Resolve credentials only through Pi's public model registry and credential APIs, and never send
  custom-base-URL or proxy credentials to the providers' official usage endpoints.
- Keep network access restricted to the fixed Codex, GitHub Copilot, and OpenRouter usage endpoints
  with bounded response reads, bounded timeouts, and redacted error text.
- Do not write session entries, messages, settings, files, credentials, or other persistent state.
- Treat all provider payloads as untrusted input.
- The interactive menu runs on the vendored `@onurpi/pi-tui-kit` workspace library; do not replace
  it with the npm `@narumitw/pi-tui-kit` package.
- Audited upstream routines keep line-level, justified complexity and length suppressions; do not
  add new suppressions without equivalent evidence.
- Preserve the upstream MIT license and update `UPSTREAM.md` when importing upstream changes.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
