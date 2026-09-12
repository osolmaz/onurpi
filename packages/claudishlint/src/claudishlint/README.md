# claudishlint

A heuristic, dependency-free linter for "Claudish" prose — the dense, metaphor-heavy style some
models slip into. It is a port and reworking of Simon Willison's
[llm-cliche-highlighter](https://github.com/simonw/tools/blob/main/llm-cliche-highlighter.html).

## API

```ts
import { lint, review } from "./index.ts";

const findings = lint("The parser is a tiny state machine. The renderer is a tiny state machine.");
// Finding[] — each with ruleId, start, end, text, and an optional count
```

- `lint(text, options?)` — run every rule (or `options.rules`, a subset of rule ids) over a full
  response and return sorted, non-overlapping findings.
- `review(text, options?)` — the decision layer: lints the message and returns
  `{ verdict, score, threshold, findings }` where `verdict` is `"rewrite"` or `"pass"`. This is the
  "when to re-prompt" knob — see [Strictness](#strictness).
- `rules` — the rule array (in `./rules.ts`). Each rule has `id`, `name`, `description`, an optional
  `minHits` (how many occurrences in one message before the rule produces findings at all; default
  1), and `find(text)`. Each `description` is feedback for whoever fixes the text: a brief note
  explaining the rule and what to write instead.

`lint` and `review` are the only exports of `./index.ts`; import `rules` directly from `./rules.ts`
when you need it.

The output is plain data, so a downstream step can format it however it needs (e.g. build a
re-prompt quoting each finding and its `description`).

## Strictness

`review()` decides whether a message is Claudish enough to warrant a rewrite — the gate a pi
extension can put on the end of the agent's turn, asking the model to fix its own prose (once per
interaction, say, rather than on every turn).

```ts
const { verdict, findings } = review(text, {
  strictness: 0.6,
  rules: { "colon-triple": 0, "vocab-metaphor": 1 },
});
if (verdict === "rewrite") {
  // send a follow-up quoting each finding and its rule's `description`
}
```

- `strictness` is a float 0–1, default `1`: re-prompt on any finding. `0` = never re-prompt
  (anything goes). It is a knob to turn _down_ when the linter calls too often — there is nothing to
  configure at first.
- The pass/fail line is a density: count-aware findings per 1000 words (`score`), compared against
  `threshold = baseDensity * (1 - strictness) / strictness`, where `baseDensity` is 10 (a local
  inside `review()`). At the default of `1` the threshold is 0, so any finding blocks. Lower
  strictness to tolerate long, mostly-fine messages: a single stray tell in a long answer then
  passes, while the same tell in a short reply — or several tells in a long one — still triggers a
  rewrite. Structural run findings (`count`) contribute their whole run; vocabulary findings
  contribute 1 each.
- `rules` is per-rule strictness overrides: `0` = ignore the rule entirely (its findings are neither
  counted nor reported), `1` = a single finding of that rule blocks regardless of message length —
  for words you absolutely cannot stand. Rules not listed use the global `strictness`.

- At strictness 0.5 the pass/fail line sits at 10 count-aware findings per 1000 words (a local
  `baseDensity` inside `review()`). Strictness 1 is the one operating point the sanity fixtures
  measure — which is why it is the default — while the density curve is a guess pending calibration,
  engaged only when you lower strictness.

## Vocabulary rules

In addition to the structural tics (anaphora runs, echo triads, chains, …), the linter ships
vocabulary rules derived from the
[load-bearing corpus](https://louisabraham.github.io/load-bearing/), a k-means analysis of which
words separate Claude-authored PR descriptions from everything else. They are split by register, and
each rule carries a `minHits` — how many occurrences in one message before it produces findings at
all:

| rule               | register                                                   | minHits |
| ------------------ | ---------------------------------------------------------- | ------- |
| `vocab-stance`     | rigour adverbs: provably, empirically, structurally, …     | 1       |
| `vocab-epistemic`  | claims and evidence: premise, refuted, verdict, …          | 1       |
| `vocab-metaphor`   | systems imagery: seam, machinery, latent, …                | 1       |
| `vocab-survival`   | persistence verbs: survived, restated, mattered            | 1       |
| `vocab-stance-2`   | common rigour adverbs: genuinely, deliberately, plainly, … | 2       |
| `vocab-metaphor-2` | common systems nouns: ceiling, floor, lever, …             | 2       |
| `vocab-survival-2` | common persistence verbs: settled, proven, persisted       | 2       |

Words in the first four rules are rare enough in ordinary English that a single hit is already a
tell, so they fire at 1. The `-2` words are ordinary English that people also use honestly, so a
single hit is ignored and the rule fires only on repetition. `ai-vocab` ("delve", "pivotal", …) also
fires at 2 for the same reason. Set any rule to `0` in `review()`'s per-rule overrides if it is not
worth the noise.

## Sanity test on real data

`test/sanity.test.ts` runs the linter over two real-data classes and asserts that it separates them:

- **positive** — every PR description in the load-bearing corpus
  (github.com/louisabraham/load-bearing) created from 2026-04-01 onwards, overwhelmingly
  Claude-authored by then;
- **negative** — the English side of `data/claudish_pairs.jsonl`, plain English that should not be
  flagged.

It prints a report (per-class flag rates, findings per 1k words, the top tell rules on each class)
and fails if the positive recall, negative false-positive rate, or their separation fall outside the
calibrated thresholds at the top of the file.

The fixtures are derived data and gitignored. Regenerate them from the repo root with:

```sh
python3 scripts/make_sanity_fixtures.py
```

This needs `data/raw/load-bearing` (a clone of the load-bearing repo) and
`data/claudish_pairs.jsonl`. If the fixtures are missing the test skips with a hint instead of
failing.

```sh
npm run sanity    # just the sanity test
npm test          # unit tests plus sanity
```
