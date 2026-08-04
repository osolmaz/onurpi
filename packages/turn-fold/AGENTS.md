# @onurpi/turn-fold

- Preserve Pi's underlying normal messages and model context. The only folding metadata written to session state is the reviewed configuration and one strict `onurpi-turn-fold-run` custom entry per new settled run.
- Keep folding policy and turn state separate from Pi component patching.
- Keep the main transcript compact and sparse. Render detailed history through documented Pi overlay and TUI APIs without adding private component imports.
- Index history without reading message bodies, render only viewport-near entries, and keep explorer caches bounded.
- Derive aggregate and per-file diffstats only from successful finalized tool-result patches. Resolve relative patch paths against Pi's documented `ctx.cwd`. Do not inspect Git or snapshot files.
- Retest component patches against each supported Pi release.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and manual.
