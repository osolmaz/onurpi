# pi-tui-history-replay

- Preserve the upstream source URL and immutable commit in `UPSTREAM.md`.
- Keep the package private while the upstream repository has no license.
- Keep replay display-only. Never put pre-compaction messages back into model context.
- Compare Pi's `SessionManager` and live-compaction event ordering before raising compatibility.
- Run `npm run check`, `npm run mutate`, and `npm run slophammer` before finishing.
