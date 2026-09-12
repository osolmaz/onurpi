# Claudishlint

Claudish is the dense, metaphor-heavy style some models slip into. Claudishlint is a heuristics
linter for that style plus a Pi extension that asks for one plain rewrite of a response that trips
it. The extension comes from
[`blackbird-merula/claudishlint`](https://github.com/blackbird-merula/claudishlint). See
[UPSTREAM.md](UPSTREAM.md) for provenance and the vendoring review.

## What it does

At the end of a turn the extension reads the last assistant message and runs the linter over its
text. When the verdict is `rewrite`, it sends one follow-up that quotes each finding beside its
rule's description and asks the model to rewrite the whole response under the embedded Simple
Language Style Guide. Facts, numbers, names, and code stay as they are. The rewrite replaces the
prose only.

The nudge happens at most once per interaction. The extension records a `claudishlint.reset` entry
on each user input and a `claudishlint.nudge` entry on each nudge, so a long working turn is
corrected one time. The first nudge carries the style guide. Later nudges point back to the guide.

## Configuration

The extension reads `~/.pi/agent/.claudishlint.json` on every check. A missing file means the
defaults. The file maps onto the linter's options.

```json
{
  "strictness": 0.8,
  "rules": {
    "ai-vocab": 0,
    "colon-triple": 1
  }
}
```

- `strictness` is a float from 0 to 1, and defaults to `1`. At `1` any finding asks for a rewrite.
  At `0` nothing does. In between the gate is a density of count-aware findings per 1000 words.
- `rules` holds per-rule overrides. `0` removes a rule and its findings. `1` blocks on a single
  finding of that rule. Rules not listed use `strictness`.

Invalid JSON in that file raises an error, so the file must parse.

## The linter

The linter has no runtime dependencies.

```ts
import { lint, review } from "./src/claudishlint/index.ts";

const findings = lint(responseText);
const { verdict, score, threshold, findings: groups } = review(responseText, { strictness: 0.8 });
```

- `lint(text, options?)` runs the rules and returns sorted, non-overlapping findings. Pass
  `options.rules` to run a subset.
- `review(text, options?)` applies the strictness gate and groups the findings by rule.

The rule set lives in [src/claudishlint/rules.ts](src/claudishlint/rules.ts), and the library notes
are in [src/claudishlint/README.md](src/claudishlint/README.md).

## Development

```bash
npm run check --workspace @onurpi/claudishlint
```

The check runs format, lint, typecheck, tests, coverage, and the dry check. Mutation testing is
opt-in with `npm run mutate --workspace @onurpi/claudishlint`.

## Not vendored

The upstream sanity test needs fixtures built from a GitHub PR corpus and the
[`adamrotmil/claudish-pairs`](https://huggingface.co/datasets/adamrotmil/claudish-pairs) dataset.
Upstream gitignores those fixtures and publishes no generator, so the test cannot run here.
