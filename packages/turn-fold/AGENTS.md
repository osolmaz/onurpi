# @onurpi/turn-fold

- Preserve Pi's underlying normal messages and model context. The only folding metadata written to session state is the reviewed configuration and one strict `onurpi-turn-fold-run` custom entry per new settled run. Never assign to `ctx.sessionManager` or to any other Pi-owned session object, because another extension or Pi itself can read those members at any time.
- Keep folding policy and turn state separate from Pi component patching. Project the transcript through the one version-gated replay entry point in `replay-projection.ts`, keep that integration free of folding policy, and restore the exact method it replaced on shutdown.
- Keep the main transcript compact and sparse. Render detailed history through documented Pi overlay and TUI APIs without adding private component imports.
- Index history without reading message bodies, render only viewport-near entries, and keep explorer caches bounded.
- Keep history search incremental and bounded. Search, filters, jump history, help state, and entry controls remain ephemeral and must not enter Pi's session.
- The explorer's regular-TUI scoped mouse mode is the only allowed terminal escape write: `?1002`/`?1006` through Pi's public terminal write API, acquired on open and released exactly once on every close path. In fullscreen mode, Pi owns mouse reporting and the explorer must not write mouse mode sequences. Do not add other terminal writes.
- Search and jump fields must preserve the expected readline and macOS terminal editing keys documented in the `text-input-keybindings` skill.
- Derive aggregate and per-file diffstats only from successful finalized tool-result patches. Resolve relative patch paths against Pi's documented `ctx.cwd`. Do not inspect Git or snapshot files.
- Retest component patches against each supported Pi release.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and manual.
