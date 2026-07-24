# @onurpi/turn-fold

- Preserve Pi's underlying session messages and model context; folding is display-only.
- Keep folding policy and turn state separate from Pi component patching.
- Derive edit diffstats only from successful finalized tool-result patches. Do not inspect Git or snapshot files.
- Retest component patches against each supported Pi release.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and manual.
