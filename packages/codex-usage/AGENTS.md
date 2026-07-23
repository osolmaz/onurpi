# @onurpi/codex-usage

- Keep usage reporting command-driven. Do not publish footer or statusline state and do not register
  model or session lifecycle hooks.
- Use only Pi's public model registry for subscription authentication.
- Keep network access restricted to the fixed Codex usage endpoint.
- Keep the Codex app-server fallback shell-free, timeout-bounded, and scoped to one command
  invocation.
- Do not write session entries, messages, settings, files, credentials, or other persistent state.
- Treat all provider and app-server payloads as untrusted input.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
