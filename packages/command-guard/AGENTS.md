# Command Guard

- Treat command parsing, path resolution, tool overrides, and final execution events as
  security-sensitive code.
- Keep the package fail closed. Parser errors, uncertain expansion, and missing final adapters must
  block covered destructive operations.
- Do not add a confirmation gate, model bypass, project allowlist, environment disable switch, or
  compatibility path that weakens the guard.
- There are exactly two permitted weakening paths, both set by the owner:
  - The session switch the owner types as `/command-guard off`. It starts on in every session, never
    reads or writes a settings file or environment variable, is never reachable from a model tool or
    an extension event, and turns back on at the next start.
  - The machine file `.command-guard.json` in the Pi agent directory with `{ "enabled": false }`
    (the owner's decision of 2026-11-23). The package reads it once at load and never writes it.
    When it says off, the extension registers only its status command. A missing, unreadable or
    malformed file keeps the guard on.
- Keep final checks one-use, memory-only, and bound to the exact command, shell, cwd, referenced
  environment values, targets, and filesystem identities.
- Use only public Pi APIs and documented public Unified Exec events. Do not change Pi core or use Pi
  private APIs.
- Add regression tests for every command family, parser uncertainty, critical path, final check, or
  adapter change.
- Preserve the exact parser pins and update `UPSTREAM.md` when a parser package or artifact changes.
- Keep mutation scripts available, but run them only when the user asks.
