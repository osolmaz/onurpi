---
name: practical-significance
description: Use when deciding whether a measured difference is meaningful enough to justify choosing, shipping, scaling, or paying for one option over another. Applies to quality and accuracy, benchmarks and latency, throughput and memory, or cost and reliability. Also covers complexity and operational risk. Distinguishes statistical uncertainty from practical and operational significance. Treats uncertain or immaterial differences as ties that favor the cheaper, faster, simpler, safer option.
---

# Practical significance

A measured winner is not automatically a meaningful winner. Decide whether the
difference is large and reliable enough to change a real choice after accounting
for time and money plus complexity, reversibility, and risk.

Use this skill for experiments, benchmarks, model comparisons, architecture
choices, product metrics, infrastructure changes, and process improvements. Use
it before `paid-compute-launch` when a comparison determines what work to fund.
For ML choices, also use `ml-experiment-design`.

## Start with the decision

Write down the decision before interpreting results:

- What action could change because of this comparison?
- Which metric is allowed to choose the winner?
- Which regressions or safety gates can veto that choice?
- What is the cheaper or simpler baseline?
- What improvement would be large enough to justify switching?

The last item is the **minimum worthwhile effect**. State it in the metric's
real units. Examples include 20 fewer failures per 10,000 requests, 5 minutes
less operator time per deployment, or enough throughput to remove one paid
worker.

Set the threshold before looking at the final comparison whenever possible. If
it was not registered, propose a threshold from product impact and cost, label
it as retrospective, and obtain agreement before treating it as a decision
rule. Do not choose a threshold merely because it makes the preferred candidate
win.

There is no universal one-percent rule. A tenth of a percentage point can be
critical in a safety system and irrelevant in a noisy benchmark. Tie the
threshold to consequences.

## Report the effect in concrete units

Always show:

- Baseline and candidate values.
- Absolute difference in the metric's native unit.
- Relative difference when useful, never by itself.
- Raw affected counts when the metric comes from cases or events.
- Dataset size, request count, repetitions, seeds, or measurement duration.

For 2,060 successes versus 2,048 among 2,953 cases, report the net 12 cases and
0.41 percentage-point difference. Do not stop at “candidate wins.”

Use direction correctly. Higher throughput may help while higher latency, cost,
error rate, or memory use may hurt. Translate rates into counts when that makes
the consequence easier to judge.

## Separate three questions

### Statistical uncertainty

Could sampling noise, run-to-run variation, or measurement error explain the
difference? Use paired analysis when both alternatives were evaluated on the
same cases or workloads.

For paired binary outcomes, retain the discordant counts:

- Cases where only the baseline succeeds.
- Cases where only the candidate succeeds.

The net success difference alone is insufficient for a paired significance
test. Use an exact McNemar test or paired bootstrap interval when appropriate.
Report the discordant counts and confidence interval. Include a p-value when it
helps interpret the test.

For stochastic training or optimization, run enough independent seeds to expose
variance. Pair seeds and data order when the design licenses it. Report every
seed, the aggregate effect, and an uncertainty interval. One run per arm cannot
establish that a small difference is stable.

For systems benchmarks, include warmup and repeated measured runs. Record the
spread, median, tails that matter to users, and environmental controls. A single
fast run is not a throughput result.

A statistically significant difference can still be too small to matter. A
non-significant result also does not prove equality. It means the evidence did
not resolve the difference at the tested scale.

Do not diagnose overfitting from one lower held-out score. A training-loss
improvement paired with a validation decline is consistent with overfitting,
but run variation, data order, and evaluation noise can produce the same
pattern. Require paired case analysis, a learning curve, repeated runs, or
another registered test before calling the cause overfitting.

### Practical significance

Does the estimated effect exceed the minimum worthwhile effect? Compare the
point estimate and uncertainty interval with that threshold.

Use these verdicts:

- **Meaningful win:** the effect clears the threshold with adequate uncertainty
  evidence and no vetoing regression.
- **Practical tie:** the effect is below the threshold even if one number is
  larger.
- **Uncertain:** the interval includes materially different outcomes or the
  experiment lacks enough independent evidence.
- **Regression:** the candidate fails a required gate or causes a meaningful
  loss elsewhere.

Do not collapse “practical tie” and “uncertain.” A tie says the observed scale is
not worth acting on. Uncertain says more evidence could change the decision.

### Operational and economic significance

Would choosing the candidate improve the whole system after including cost and
speed plus complexity, reliability, and risk?

Report the relevant tradeoffs in real units:

- Additional dollars per run, month, million requests, or shipped unit.
- Additional wall time and total compute time.
- Throughput or latency change under the same workload.
- Memory and storage plus bandwidth and operator burden.
- Failure recovery and reversibility plus implementation risk.

Calculate incremental value where possible. Examples include additional correct
cases per $100, dollars per percentage point, hours saved per month, or the
number of workers removed. State the assumptions behind projected values.

A quality improvement can be real but economically irrational. A faster system
can be a bad choice if it creates unacceptable errors. Keep the decision tied to
the stated objective and gates.

## Preserve candidate roles and decision authority

Metrics compare candidates within a decision contract. They do not silently
change what each candidate was built to do. Before a consequential comparison,
record each candidate's role and eligibility plus its current decision state.

Useful roles include diagnostic, ablation, search checkpoint, refit, production
candidate, and release model. Keep three decision states separate. **Observed**
means that metrics are available with no selection implied. **Recommended**
means that the evidence and tradeoffs support a choice. **Approved** means that
the person or process with decision authority selected it.

A metric lead can support a recommendation. It cannot promote a diagnostic or
report-only checkpoint to production when the registered plan requires a
separate choice. If explicit approval is required, only a direct selection of
the named candidate marks it approved. An ambiguous acknowledgment leaves it
recommended.

When candidates are practically tied, retain the registered incumbent or
production candidate unless the user chooses another tradeoff. Apply the
cheaper-option tie rule to the whole switch. Include repeated experiments,
invalidated artifacts, operator work, and provenance changes rather than
looking only at the candidate's original training cost.

Before recommending a switch, list the downstream work tied to the incumbent.
Include pilots, probes, generated data, exports, benchmarks, release evidence,
and cost estimates that would need verification or repetition. State whether
the comparison surface was authorized to change production authority. If that
contract is unclear, present a recommendation and ask for the value judgment.

## Handle multiple metrics without shopping

Choose one primary decision metric before inspecting final results. Use
secondary metrics to expose regressions, explain behavior, and enforce gates.
Do not search across metrics after the run and promote whichever one favors the
preferred option.

When metrics disagree:

1. Check whether a registered primary metric and veto gates resolve the choice.
2. Show every meaningful conflict in one comparison.
3. Decide whether either option Pareto-dominates the other.
4. If the tradeoff remains, ask for the user's value judgment before spending or
   shipping.

A tiny primary-metric gain does not erase a large cost or speed regression. A
registered metric identifies what to measure. It does not make every nonzero
difference worth buying.

## Use the tie rule

When alternatives are practically tied or uncertainty is too high to justify a
switch, prefer the option that is:

- Cheaper to run and repeat.
- Faster under the real workload.
- Simpler to implement and audit.
- Easier to pause, resume, or reverse.
- Less likely to create operational failures.

This is the default, not an absolute law. A user may choose another option for a
stated reason, but the tradeoff must be explicit.

Do not turn a tie into a winner because a protocol uses `argmax`. Selection code
should support a tie region or minimum-effect gate. If an existing protocol
forces any positive delta to win, challenge it before the result triggers
substantial cost or an irreversible decision.

## Decide whether to gather more evidence

Run another experiment only when it could change the decision. More evidence is
useful when the plausible effect crosses the minimum worthwhile threshold and
the cost of resolving it is lower than the cost of choosing wrongly.

Do not repeat an experiment merely to obtain a smaller p-value for an effect
already known to be immaterial. Do not launch a full-scale run when a paired
subset, additional seed, or short systems benchmark can resolve the uncertainty.

Before asking for more data, state:

- The uncertainty that remains.
- The result that would change the decision.
- The cheapest valid measurement.
- Its expected time and cost.

## Required decision summary

Present consequential comparisons in this order:

1. **Decision:** what choice is being made.
2. **Effect:** baseline, candidate, absolute delta, relative delta, and raw
   counts where applicable.
3. **Uncertainty:** paired evidence, repetitions or seeds, and an interval.
4. **Worthwhile threshold:** the minimum effect that justifies switching.
5. **Tradeoffs:** cost and speed plus complexity, reliability, and risk.
6. **Verdict:** meaningful win, practical tie, uncertain, or regression.
7. **Action:** choose, keep the baseline, gather bounded evidence, or ask the
   user for a value judgment.

Lead with the verdict in plain language. Do not hide a near-tie behind decimal
precision or a “statistically significant” label.

## Worked decision pattern

A T5 decoding comparison trained one student per method. Beam search produced
2,060 exact cases and greedy produced 2,048 among 2,953 development cases. The
absolute gain was 12 cases, or 0.41 percentage points. Greedy had better chrF and
was about 41% faster.

That evidence does not establish a meaningful beam-search win. There was one
stochastic training run per arm, no reported discordant-case analysis, and no
minimum worthwhile exact-match gain. The result is at best uncertain and is a
practical tie under any cost-aware threshold larger than 0.41 points. The tie
rule selects greedy unless new paired and repeated evidence clears an agreed
threshold.

## Forbidden shortcuts

- Do not call any positive delta an improvement without stating its size.
- Do not equate a benchmark winner with a decision winner.
- Do not use relative change without absolute values and baseline scale.
- Do not claim paired significance from aggregate success counts alone.
- Do not treat one stochastic run per arm as stable evidence for a small effect.
- Do not use p-values as a substitute for a minimum worthwhile effect.
- Do not ignore secondary regressions or operational cost.
- Do not invent a decision threshold after seeing results without labeling and
  approving it.
- Do not spend substantially more to resolve an effect too small to matter.
- Do not let an automatic `argmax` cross a spending or shipping boundary.
- Do not promote a diagnostic, ablation, or report-only checkpoint beyond its
  registered role from a metric lead alone.
- Do not label a candidate approved when the evidence only supports a
  recommendation.
- Do not call a held-out regression overfitting without evidence that separates
  it from run variation.

## Final check

Before acting on a measured winner, verify:

- The real decision and primary metric were stated.
- Candidate roles, production eligibility, and decision authority were recorded.
- The three decision states were kept separate.
- The absolute effect and raw counts are visible.
- Statistical uncertainty matches the experimental design.
- A minimum worthwhile effect is stated and justified.
- Cost and speed are included together with complexity, reliability, and risk.
- Conflicting metrics and regressions are visible.
- Near-ties favor the cheaper and simpler option.
- More experimentation can still change a real decision.
- Spending outside the `paid-compute-launch` autonomous allowance and every irreversible action has explicit approval.

If any item fails, report the comparison as unresolved or practically tied
instead of declaring a winner.
