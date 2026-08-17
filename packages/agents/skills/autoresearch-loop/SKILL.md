---
name: autoresearch-loop
description: Run an iterative feature-search loop in the style of karpathy/autoresearch, with a frozen evaluation harness, one editable feature file, and a journal of every experiment. Use when searching for a discriminating metric, feature, heuristic, or scoring function against a fixed dataset, or when the user mentions autoresearch, a research loop, or iterating on features until a clear separation appears.
---

# Autoresearch loop

This skill runs a disciplined search for a feature that separates two
groups in a fixed dataset. For model training, refits, checkpoint selection,
or accelerator experiments, also use `ml-experiment-design` before launching
compute. Use `paid-compute-launch` before any paid accelerator iteration. An
autoresearch loop may choose the next hypothesis automatically, but it cannot
cross an unapproved spending boundary automatically.

The discipline comes from three artifacts
kept in one directory: a harness that never changes during the search,
a single feature file that changes every experiment, and a journal that
records every run whether it worked or not. No external repo is needed;
the loop is just the agent iterating in this style.

## Setup, before the first experiment

Create a working directory with three files.

**`harness.py` (frozen).** Loads the dataset once, calls the candidate
`score_doc(item)` function on every item, and prints the metrics that
decide keep-or-discard. Good defaults for a two-group separation task:

- AUC between the groups (ties counted half).
- Margin at the edge: the gap between the worst-scoring member of one
  group and the best of the other, as a percentage of the midpoint.
- Leave-one-out accuracy with a midpoint threshold refit on each fold,
  so the margin is not an artifact of one document.
- Scores for any held-out or context-only items, printed but never used
  for selection.

Freeze the harness after the first run. If a bug forces a change,
rerun every kept result and note the change in the journal.

**`feature.py` (editable).** Defines one function with a fixed
signature, for example `score_doc(seq) -> float`. This is the only
file that changes between experiments. State the input contract in the
docstring so later experiments cannot drift.

**`program.md` (the rules).** Write down the goal, the input contract,
what is in and out of bounds (for example "sequence structure only,
nothing lexical"), the keep criterion (for example "keep only auc 1.0
and loo 18/18; among keepers maximize margin"), and the requirement
that every run is journaled.

## The loop

One experiment is one edit to the feature file followed by one harness
run. After each run, append a journal entry with the idea in one line,
the numbers, and keep or discard. Then decide the next edit from what
the numbers said, not from the original plan.

- Batch cheap candidates. When testing many ideas in one generation,
  write a sweep script that evaluates all of them in one process and
  journal the whole generation together. This is far cheaper than one
  shell invocation per idea.
- Vary the winner before trusting it. A result that survives only one
  parameterization is a tuned cliff; a plateau across neighboring
  parameter choices is a finding. Report the plateau range.
- Chase the failure case. The most informative next experiment usually
  targets the single item sitting closest to the boundary.
- Record negative results in the journal with the same care as
  positives. "Order statistics alone fail (auc 0.5 to 0.9 across eight
  variants)" is a finding that stops future re-litigation.
- Never select on held-out or unlabeled items. Print their scores as
  context; the keep decision uses only the labeled groups.

## Paid iterations

Freeze and validate the cheapest local or CPU harness before remote scaling.
When a candidate needs paid compute, estimate the entire proposed generation or
sweep rather than only the next Job. Present measured throughput, hardware
alternatives, total accelerator-hours, and the low and high cost before launch.

Stop the loop for explicit approval whenever `paid-compute-launch` classifies
the next stage as substantial. Approval covers only the stated method,
hardware, concurrency, and cost ceiling. A slower winning method, failed retry,
or larger follow-up returns to the approval gate.

Long output-producing iterations must publish durable units and support tested
boundary resume. If a shared implementation defect appears in one member of a
fleet, pause the affected fleet before trying another candidate. Preserve
negative results and partial valid outputs so the loop does not pay to recreate
them.

## Stopping

Stop when a kept result plateaus and further edits only trade margin
sideways, or when a generation of diverse candidates all fail, which
means the signal is not where the program said it would be. In either
case, finish the journal with a conclusions section: the winning
feature and its numbers, the plateau evidence, and the negative
results. Promote the winner out of the loop directory (into the real
analysis script or skill) only after the journal is complete.

## Journal entry format

```
## Exp 12: spine percentile vs pooled CDF
Idea: replace the 10-15 word ramp with the corpus empirical CDF.
auc=1.000 margin=+17% loo=18/18 -> keep (best constant-free so far)
Next: reward consecutiveness; try pair kernels.
```
