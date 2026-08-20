# @onurpi/pi-codex-compaction

- Use only documented Pi extension hooks and exported public APIs. Do not patch Pi internals or
  write session entries directly; the native checkpoint belongs in Pi's normal `CompactionEntry`.
- Send active Codex credentials only to the validated official Codex endpoint. Never log, persist,
  or test with real credential material; test tokens are structural fakes.
- Keep compaction fail-closed: no fallback to text summarization, no replay of malformed or
  model-mismatched checkpoints, no credentials to custom base URLs.
- Keep the local checkpoint marker out of provider context and out of OpenAI requests.
- This package owns compaction for the built-in `openai-codex` provider and `openai-codex-*`
  switcher profiles. `context-window-policy` and `reliable-compaction` must pass that family
  through; preserve their non-Codex behavior.
- Add or update tests for every behavior change.
- Before finishing, run `npm run check` and `npm run slophammer`. Then run `git diff --check` and an
  installed Pi smoke test.
- Keep mutation testing manual unless the user explicitly requests it.
