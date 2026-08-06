# Unified Exec

- Preserve the public tool contract and cross-platform behavior documented in `README.md`.
- Treat subprocess, shell, PTY, filesystem, and synthetic follow-up changes as high risk.
- Keep `on_exit` opt-in and preserve the exactly-once rule: completion is delivered by a finalized
  direct tool result or one follow-up, never both.
- Never send a queued completion wake while an agent run is active. Flush eligible wakes only after
  `agent_settled`.
- Keep output bounded in memory and complete in the per-session log. Create POSIX logs exclusively
  with mode `0600`.
- Keep PTY support optional. Pipe mode must work when the native provider cannot load.
- Reject unchecked input and do not add explicit `any`, unsafe casts, network access, telemetry,
  credential access, or background persistence.
- Preserve the upstream MIT license and update `UPSTREAM.md` when importing upstream changes.
- Add regression tests for process lifecycle, wake coordination, cancellation, platform behavior,
  and shutdown changes.
- The package enforces the repository complexity limit. A small set of audited upstream lifecycle
  and rendering routines has line-level, justified complexity suppressions so their event-race
  behavior remains intact; do not add new suppressions without equivalent evidence.
- Keep mutation scripts available, but run them only when explicitly requested.
