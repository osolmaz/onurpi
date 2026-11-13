# Command Guard

- Treat command parsing, path resolution, tool overrides, and final execution events as
  security-sensitive code.
- Keep the package fail closed. Parser errors, uncertain expansion, and missing final adapters must
  block covered destructive operations.
- Do not add a confirmation gate, model bypass, project allowlist, environment disable switch, or
  compatibility path that weakens the guard.
- The only permitted weakening path is the session switch the owner types as `/command-guard off`.
  It must start on in every session, never read or write a settings file or environment variable,
  never be reachable from a model tool or an extension event, and turn back on at the next start.
- Keep final checks one-use, memory-only, and bound to the exact command, shell, cwd, referenced
  environment values, targets, and filesystem identities.
- Use only public Pi APIs and documented public Unified Exec events. Do not change Pi core or use Pi
  private APIs.
- Add regression tests for every command family, parser uncertainty, critical path, final check, or
  adapter change.
- Preserve the exact parser pins and update `UPSTREAM.md` when a parser package or artifact changes.
- Keep mutation scripts available, but run them only when the user asks.
