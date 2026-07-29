# @onurpi/goal

- Preserve Goal's upstream interface and session types. Keep its MIT attribution.
- Start autonomous continuation only from `agent_settled`. Never queue it from `agent_end`.
- Pause safely after interruption, terminal failure, repeated outcome cycles, or the automatic-run checkpoint.
- Persist only compact branch-aware goal snapshots and version-prefixed outcome hashes. Never persist raw tool or model content in safety state.
- Keep continuation messages short and inject the active objective through `before_agent_start`.
- Do not modify Pi source, private APIs, normal messages, compaction entries, or provider behavior.
- Add or update tests for every behavior change.
- Before finishing, run `npm run check` and `npm run slophammer`. Then run `git diff --check` and an installed Pi smoke test.
- Keep mutation testing manual unless the user explicitly requests it.
