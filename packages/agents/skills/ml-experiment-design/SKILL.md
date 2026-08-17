---
name: ml-experiment-design
description: Use for ML experiment and training decisions involving data splits, checkpoint reuse, fresh restarts, refits, hyperparameter search, ablations, distillation, evaluation, model selection, synthetic data, or expensive accelerator jobs. Requires compute-aware alternatives and explicit approval before discarding useful weights or repeating substantial training for a small marginal change.
---

# ML Experiment Design

Design ML work to answer the actual question with the least waste that preserves
validity. Experimental neatness is not automatically worth a full training run.
Use this skill alongside task-specific training, Hugging Face, evaluation, or
inference skills. Use `practical-significance` whenever a measured difference
chooses an arm, checkpoint, decoding method, architecture, or production model.
Before paid accelerator work, also use `paid-compute-launch`. This skill decides
whether an experiment is valid and useful. `practical-significance` decides
whether its result matters, while `paid-compute-launch` owns spending, hardware,
durability, and approval.

## Start with the practical decision

State what decision the experiment must support. Examples include choosing a
checkpoint, testing whether more data helps, selecting a decoding method, or
producing a release model. Do not turn a production task into a clean-room
research exercise unless the user wants that.

## Run bounded low-cost experiments autonomously

Experiments with a hard cumulative paid-compute ceiling below $5 may proceed
without asking for approval. Count setup, failed attempts, retries, and recovery
Jobs together. Confirm before each launch that actual spending plus its
worst-case cost remains below $5. Follow `paid-compute-launch` for the full rule
and stop before reaching the threshold.

Low cost does not relax scientific validity or artifact preservation. It does
not authorize deleting a checkpoint, changing production authority, opening
sealed data, or making an irreversible release. Do not split related work into
separate experiment names to stay below the threshold.

Before launching accelerator work, record:

- the decision to be made.
- the metric and data split allowed to make it.
- the existing model or checkpoint and whether it is usable.
- the exact change from the previous run.
- the number and percentage of rows added, removed, or relabeled.
- expected accelerator time, wall time, and cost for each credible option.
- what trained state each option preserves or discards.
- the cheapest run that can resolve the uncertainty.

Use exact counts and percentages. A change of 2,953 rows out of 59,022 is about
5%, not an abstract "new split." Make the scale visible before discussing
methodological preferences.

## Treat trained weights as an asset

A checkpoint contains expensive learned state. Do not discard it merely because
a fresh refit is conventional, aesthetically cleaner, or easier to describe.
The burden of proof belongs to the restart.

A valid completed model is not superseded by a benchmark loss below the minimum
worthwhile effect. When the difference is uncertain or practically tied, keep
the registered production candidate as the incumbent and preserve its exact
state. A challenger must clear a threshold large enough to justify repeating or
revalidating the downstream work tied to that incumbent.

Already-spent compute does not prove model quality. It establishes that the
checkpoint is a reusable asset with a real replacement cost. Report the
accelerator time already invested, the cost to retrain it, and the completed
pilots, generated data, exports, or benchmarks that a switch would invalidate.
Keep model selection separate from artifact disposal. A model can remain
preserved even when another candidate is approved for production.

Consider these options in order:

1. Use the selected checkpoint as the final model.
2. Continue from it for a short, explicit schedule on the intended data mix.
3. Fine-tune with replay so added rows do not dominate the existing data.
4. Run a small paired pilot to measure whether continuation helps.
5. Start a fresh refit only when it has a concrete expected benefit that
   justifies repeating the compute.

A fresh refit may be justified when initialization itself is under study, when
all comparison arms must start identically to isolate one variable, when the
old checkpoint is invalid or contaminated, or when uniform exposure to a
materially changed dataset is essential. State which reason applies and what
would be invalid without the restart.

Do not claim that a fresh run is safer or cleaner without explaining the
practical consequence. If the selected checkpoint excluded a small development
slice, leaving that slice out of the final weights may be perfectly acceptable.
Training all rows from scratch is one option, not an automatic requirement.

## Require approval for expensive restarts

Stop and ask for explicit approval before launching a fresh restart when any of
these conditions holds, unless it is a bounded experiment below $5 and all
useful existing weights remain preserved:

- a valid trained checkpoint already exists.
- the restart discards most or all prior training.
- the data or configuration change is small relative to the completed run.
- the main justification is experimental purity rather than measured quality.
- the repeated compute is substantial.
- a cheaper continuation or pilot could answer the same question.

The approval request must say, in plain language:

- what weights would be discarded.
- what changed, with exact counts and percentages.
- how much training would be repeated.
- the expected time and cost.
- the reuse and continuation alternatives.
- why the restart is still recommended, if it is.

Do not bury this choice inside a long plan. Do not proceed because an earlier
plan called the refit "frozen." A plan records a decision under prior
assumptions. New cost information, a mistaken premise, or an obviously poor
tradeoff requires escalation before spending more compute.

## Keep split roles precise

Name every split and its role. Do not conflate development, validation,
benchmark, and test data.

- **Training data** supplies gradients.
- **Development data** selects schedules, checkpoints, mixtures, or
  hyperparameters.
- **Report-only validation** measures a frozen choice and cannot change it.
- **Benchmarks** follow their registered selection rules.
- **Sealed tests** open once, after all choices are frozen.

If a development subset is held out during search, say exactly what it is. For
example, "2,953 approved human training rows held out from search gradients and
used to select duration." Do not describe it vaguely as validation data.

Using a development split to choose a duration does not force a fresh all-data
refit. Compare the value of incorporating those rows with the cost of rerunning
the rest. If a final refit is chosen, keep an independent report-only surface so
selection does not consume the final evaluation.

## Register candidate roles and authority

Keep a candidate registry whenever more than one checkpoint could be mistaken
for the production model. For each candidate, record:

- Exact repository revision and subfolder or artifact path.
- Registered role, such as diagnostic, search checkpoint, refit, production
  candidate, or release model.
- Training data and duration plus the decision that created it.
- Evaluation surfaces and whether they may select production use.
- Existing pilots and generated data plus exports and benchmarks tied to it.
- Accelerator time already invested, checkpoint size, retraining cost, and
  preservation status.
- Decision state as observed, recommended, or explicitly approved.

Do not promote a diagnostic, ablation, or report-only checkpoint because it has
the largest reported number. First check whether its role permits production
selection, whether the difference is practically meaningful, and who has
selection authority. Report-only metrics can support a recommendation when the
plan allows it. They cannot supply missing approval.

When a plan requires a maintainer choice, keep `recommended` and `approved`
separate in status files and prose. Only a direct selection of the named
candidate changes the state to approved. Record the decision and its evidence
before downstream generation, export, or release work begins.

Before switching away from the registered production candidate, inventory the
work that depends on it. State which decoding studies, target sets, probes,
cost projections, and release evidence remain valid. Include the cost and delay
of repeating invalidated work in the comparison. A practically tied challenger
does not displace the incumbent merely because it wins an `argmax`.

## Separate research fairness from production efficiency

Fresh initialization is useful when comparing arms and isolating variables. It
prevents a larger-data arm from inheriting an advantage from a smaller-data
checkpoint. That does not imply that the final production model must also start
fresh.

Label each run as one of:

- **causal comparison**, where controlled initialization and one-variable
  changes matter.
- **model selection**, where the best existing checkpoint may be the result.
- **production improvement**, where checkpoint reuse is normally preferred.
- **final audit**, where no training choice may change.

Do not apply the rules of one category to another without explanation.

## Challenge low-value experiments

Estimate marginal value before scaling. Define the minimum worthwhile effect in
the metric's real units. If the observed difference is smaller or unresolved,
treat the arms as tied and prefer the cheaper one. Use `practical-significance`
for uncertainty, paired evidence, repeated seeds, and conflicting metrics.

Ask:

- What uncertainty remains after the completed run?
- Could the proposed run change the decision?
- Is the changed data large or different enough to matter?
- Does the expected gain justify the compute and delay?
- Can a subset, shorter schedule, or paired continuation test answer first?

When a full run repeats more work than the changed input plausibly warrants,
recommend the cheaper option. If expected benefit is speculative, say so. Do
not use "standard practice" as a substitute for an estimate.

Cancel or redesign a planned run when its result cannot affect any downstream
decision. Preserve negative results so the same idea is not rerun later.

## Respect hard model and data constraints

Treat the requested model family, size, revision, tokenizer, and dataset
membership as hard constraints unless the user approves a change. Never
silently substitute a smaller or larger model to save time or recover from a
failure.

Do not silently:

- change a candidate's registered role or approval state.
- promote a diagnostic or report-only checkpoint to production.
- drop, truncate, replace, repair, or refill rows.
- change a nominal corpus to hit a round count.
- alter decoding, precision, or initialization between comparison arms.
- use validation, benchmark, or test data to make a training-only choice.
- reuse a checkpoint in an arm registered as fresh initialization.
- start fresh in a production run registered to continue.

Report the retained row count even when a corpus has a rounded public name. A
"10M" corpus containing 9,999,555 approved rows remains 9,999,555 rows and is
not refilled without approval.

## Make numerical and operational choices explicit

Record parameter dtype, optimizer-state dtype, autocast dtype, seed, batch
size, schedule, clipping, and data order. Mixed precision must not silently
change the stored parameter or optimizer precision.

Before a large run, require the cheapest relevant gates:

- input membership and representation audit.
- model construction and finite loss.
- tiny fit that proves loss can fall.
- memory and throughput check.
- deterministic or exact-resume check when recovery matters.

For expensive remote work, preserve immutable launch inputs, model and data
revisions, exact checkpoints, output checksums, and physical Job identities.
Use operational timeouts as safety limits, not hidden scientific horizons.
Resume a valid run rather than restart it after an infrastructure failure.

## Treat large generation as an experiment

Synthetic-data and teacher-target generation can cost more than training. Apply
the same decision discipline before scaling them. Compare decoding methods on
both the allowed quality surface and measured full-run cost. A small quality
gain does not automatically justify a large throughput penalty.

Freeze the teacher and model revision before full generation. Freeze decoding
and precision at the same point. Batch size and normalization become fixed
there too, together with the implementation contract. Benchmark
credible hardware with the real producer and a representative input sample.
Select hardware from measured cost and wall time rather than memory capacity or
reputation.

Large generation must create recoverable scientific assets while it runs. Use
small deterministic output units, immutable checksums, durable manifests, and
boundary resume. A progress count without persisted target bytes has no reuse
value. Follow `paid-compute-launch` for the loss window and canary requirements. It
also owns fleet-failure handling and approval.

If one worker reveals a deterministic shared defect, pause every affected
worker at its next safe boundary. Do not spend more compute producing outputs
under a contract already known to be invalid.

## Use an alternatives table

Before a consequential training decision, present a compact comparison such as:

| Option | Preserves weights | Repeated compute | Scientific value | Practical risk |
| --- | --- | ---: | --- | --- |
| Use selected checkpoint | Yes | None | Keeps search-trained model | Omits held-out development rows from gradients |
| Continue with replay | Yes | Low | Tests value of added rows | Needs an explicit weighting schedule |
| Fresh all-data refit | No | Full run | Uniform exposure from one initialization | High cost and uncertain marginal gain |

Fill the table with the real values. Recommend one option, but keep the tradeoff
visible.

## Explain before acting

Before launching an expensive Job, give the user a short statement covering:

1. what is being trained.
2. what existing state is reused or discarded.
3. what changed since the previous run.
4. why this run is worth its cost.
5. what cheaper alternative was rejected.

Use direct language. If the main reason is protocol purity, say that. If the
practical gain is likely small, say that too. The user should never discover
mid-run that a useful checkpoint was discarded to incorporate a small slice of
additional data.

## Final review

Before approving the plan, verify:

- the experiment can change a real decision.
- split roles and selection surfaces are unambiguous.
- candidate roles, production eligibility, and exact artifact paths are recorded.
- the three decision states remain distinct.
- a proposed model switch includes its downstream invalidation and repetition cost.
- a sub-threshold challenger does not displace the incumbent production candidate.
- production selection and checkpoint preservation remain separate decisions.
- row deltas and percentages are visible.
- checkpoint reuse was considered first.
- expensive restarts have explicit approval or a verified cumulative ceiling below $5.
- comparison arms differ only where intended.
- no silent model substitution or data repair is possible.
- compute, time, cost, and stopping conditions are stated.
- recovery resumes useful state.
- large generation publishes durable outputs throughout the run.
- decoding quality is presented with measured speed and full-run cost.
- measured winners clear a stated minimum worthwhile effect.
- uncertain or immaterial results use the cheaper-option tie rule.
- shared worker defects pause the affected fleet.
- report-only and sealed data cannot influence training choices.

If any item fails, revise the plan before launching compute.
