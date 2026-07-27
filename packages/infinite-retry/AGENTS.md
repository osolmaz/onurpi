# @onurpi/infinite-retry

- This package is an explicitly authorized private-runtime patch for Pi 0.82.1. Do not widen the
  supported version without reviewing Pi's retry implementation and rerunning the live lifecycle
  tests.
- Patch only `AgentSession._prepareRetry()` and `AgentSession._willRetryAfterAgentEnd()`.
- Keep Pi's existing retry classifier, continuation path, events, assistant-error persistence, and
  Escape cancellation behavior.
- Do not append session messages or custom entries, change schemas, write sidecar state, or patch
  generated files in the installed Pi package.
- Backoff must use overflow-safe saturation and remain capped at 600,000 milliseconds.
- A retry-now action may wake a pending wait but must never abort or duplicate an active provider
  request.
- Prototype changes must be idempotent, reversible, and restored during session shutdown.
- Fail closed on unsupported Pi versions or private-runtime shape mismatches.
- Add or update tests for every behavior change.
- Before finishing, run `npm run check`, `npm run slophammer`, and `git diff --check`.
- Keep mutation-testing scripts available, but run them only when explicitly requested or
  investigating test-suite strength.
