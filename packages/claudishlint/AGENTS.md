# Claudishlint

- Preserve the upstream linter behavior and rule set documented in `README.md`.
- Treat the `agent_end` path as high risk. Keep the one-nudge-per-interaction rule and the
  `input`-sourced reset entry that bounds it.
- Keep the extension free of process execution, network access, telemetry, credential access, and
  background resources. It reads one optional config file and appends session entries only.
- Keep the linter free of runtime dependencies.
- Never weaken the tolerance for a missing config file, and never swallow a malformed one silently.
- Update `UPSTREAM.md` when importing upstream changes, and keep the permission note accurate.
- Add a test with every rule or gate change, and keep the extension factory covered through the Pi
  event contract in `index.test.ts`.
- Keep mutation scripts available, but run them only when explicitly requested.
