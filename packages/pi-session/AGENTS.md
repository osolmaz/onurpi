# @onurpi/pi-session

- Keep the CLI read-only. Do not migrate, append, repair, rename, or delete Pi sessions.
- Use Pi's documented public session APIs. Do not import Pi internals.
- Keep all excerpts and complete outputs bounded. Never emit raw tool-result bodies, images, binary
  payloads, reasoning, signatures, or custom metadata.
- Treat session files as untrusted input. Preserve deterministic handling for malformed records,
  duplicate IDs, missing parents, and cycles.
- Keep credential redaction narrow and tested. Do not print credentials or session secrets in tests,
  logs, or errors.
- Keep observed session evidence separate from conclusions. The CLI must not infer task state,
  completion, or next actions.
- The package is a standalone CLI. Do not register a Pi extension, tool, command, skill, prompt,
  workflow, or theme.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
