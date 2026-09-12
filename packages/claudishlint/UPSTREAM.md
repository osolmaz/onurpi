# Upstream provenance

`@onurpi/claudishlint` is based on
[`blackbird-merula/claudishlint`](https://github.com/blackbird-merula/claudishlint).

- Release: `0.1.0` (npm `@blackbird-merula/claudishlint`)
- Commit: `79cd78621d5c99ffe6cc6aa0e8edc144a49ddd20`
- Retrieved: September 12, 2026
- License: none stated upstream. The repository carries no license file, its `package.json` has no
  `license` field, and its README has no license section. Onur Solmaz confirmed the author's
  permission for this use on September 12, 2026. The package stays private and is not published.

## Reviewed material

The review covered every file in the pinned commit:

- `src/index.ts` (vendored as `src/extension.ts`)
- `src/claudishlint/index.ts`
- `src/claudishlint/rules.ts`
- `src/claudishlint/types.ts`
- `src/claudishlint/finders.ts`
- `src/claudishlint/README.md`
- `src/claudishlint/test/lint.test.ts`
- `src/claudishlint/test/overfitting.test.ts`
- `src/claudishlint/test/rules.test.ts`
- `src/claudishlint/test/sanity.test.ts`
- `README.md`
- `package.json`, `package-lock.json`, `tsconfig.json`, `biome.json`, `.gitignore`

## Runtime audit

- Process execution: none. The extension starts no process and imports no child process module.
- Shell behavior: none. It registers no tool and overrides no tool.
- Filesystem: it reads, and never writes, one file: `.claudishlint.json` inside the Pi agent
  directory. The read tolerates `ENOENT` and lets every other error, including a parse failure or a
  shape mismatch, escape.
- Network: none.
- Credentials and telemetry: none.
- Provider interception: none. It does not touch models, providers, or request payloads.
- Session state: it appends two custom entry types, `claudishlint.reset` and `claudishlint.nudge`,
  and it sends at most one follow-up message per interaction.
- Trust handlers and background resources: none. There is no timer, watcher, server, or persisted
  daemon.

## Reviewed behavior

- On each user input that is not extension-sourced, it records `claudishlint.reset`.
- At `agent_end` it lints the last assistant message, skipping a turn with no assistant message and
  a turn already nudged after the last reset.
- When the verdict is `rewrite`, it appends `claudishlint.nudge` and sends one follow-up with the
  findings and the style guide.

## Known upstream behavior

- The `emoji-heading` finder also fires on a plain line that opens with an emoji, and it misses a
  header or bullet whose only content is the emoji. Its description scopes it to an emoji heading a
  markdown header or list item. The vendored tests pin the current behavior. The decision to narrow
  the rule belongs upstream.

## Current state

The package is vendored but switched off. The root Pi manifest does not list
`./packages/claudishlint/index.ts`, so Pi does not load the extension. The source, the tests, and
the CI checks stay in place. To switch it on, add that entry back to `pi.extensions` in the root
`package.json`, then run `npm run settings:reset` and `npm run settings:sync`.

## OnurPi adaptations

- `src/index.ts` moved to `src/extension.ts` so the package root `index.ts` stays the Pi entry
  point, as in every other package here.
- The upstream Biome formatting (tabs, no semicolons) is reformatted to the repository Prettier
  settings, and the vendored sources use the repository's explicit `.ts` import extensions.
- The upstream tests moved with the source and now run under Vitest. Vitest accepts the existing
  `node:assert/strict` assertions, so the assertions are unchanged apart from the test import and
  one bounds guard in `lint.test.ts`.
- The `tsconfig.json` library is `ES2023`, because the extension uses `findLast` and
  `findLastIndex`.
- Bounds in `finders.ts` are asserted at the accumulated sentence indexes, and the parsed
  `.claudishlint.json` value is typed before use, to satisfy `noUncheckedIndexedAccess`.
- Three line-level ESLint suppressions carry a justification each: the complexity of the upstream
  sentence-run loop, `String#match` in place of `RegExp#exec`, and the upstream emoji character
  class that combines marks on purpose. The last one replaces the upstream Biome ignore comment.
- `src/config.ts` is local. It reads and validates `.claudishlint.json`, because the upstream
  extension passes the parsed value straight to `review()`. A file with `null`, an unknown key, an
  unknown rule id, a non-numeric `strictness`, or a rule override other than `0` or `1` now raises a
  clear error instead of crashing the handler or silently dropping the gate.
- `index.test.ts` is local. It drives the extension factory through the Pi event contract.
- The upstream `sanity.test.ts` is not vendored. It needs `fixtures/*.jsonl` built by an unpublished
  script from a GitHub corpus and the `adamrotmil/claudish-pairs` dataset, so it cannot run here.
- The upstream `data/` fixtures, the calibration corpus, and `package-lock.json` (`biome`,
  `@types/node`) are not vendored. The linter has no runtime dependencies and the package inherits
  the repository toolchain.
