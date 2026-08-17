---
name: paid-compute-launch
description: Use before paid accelerator work that launches, scales, retries, or automatically continues. This includes training and batch inference plus synthetic-data generation, evaluations and sweeps, or multi-Job fleets. Allows bounded, non-substantial experiments below $5 without asking. Requires measured cost and hardware evidence, durable partial outputs, tested pause and resume, explicit approval for every substantial launch, and fleet-wide containment after shared failures.
---

# Paid Compute Launch

Make paid compute an explicit decision rather than the automatic next step in a
plan. The user should know the likely cost, the useful state at risk, and the
recovery behavior before a Job starts.

Use `practical-significance` first when experiment or benchmark results choose
what to fund. Use this skill with `ml-experiment-design` when scientific choices
are involved. For Hugging Face Jobs, also use the official `hf-cli` skill, the personal
`huggingface` skill, and `hf-job-control`. For local inference launches, also use
`safe-inference-launch`.

## Allow small experiments below $5 without asking

A non-substantial experiment may proceed without asking for approval when its
hard total cost ceiling is less than $5. Every substantial launch still needs
explicit approval. Keep the price check, timeout, durable outputs, recovery,
containment, and evidence requirements that apply to the work.

Count all related attempts, retries, setup, and recovery Jobs against one
cumulative ceiling. Include money already spent. Before every new Job, confirm
that actual cost so far plus the Job's worst-case cost remains below $5. Stop
and ask before a launch that could bring the total to $5 or more. Do not split
one experiment into smaller labels or logical runs to evade the threshold.

This permission does not authorize irreversible actions, opening sealed data,
deleting useful checkpoints, changing an approved production model, or
publishing a release. A stricter project or user limit still wins.

## Decide whether the launch is substantial

A launch is substantial when any condition below applies:

- It uses more than one accelerator Job.
- Expected wall time exceeds 30 minutes.
- Total planned usage exceeds two accelerator-hours.
- Projected cost exceeds $20.
- It produces more than 100,000 outputs.
- Losing one attempt would materially delay the work.

Stop before every substantial launch and present a launch review. Obtain
explicit approval after the user has seen it. Approval for an earlier plan does
not cover a later hardware choice, larger fleet, slower decoding method, higher
price, or new cost estimate.

A non-substantial bounded experiment below $5 does not require a formal
approval round. It still needs a price check, an operational timeout, and a
clear output location.

## Write the launch review

State the practical decision and include:

- Model, revision, code digest, input revision, and exact row count.
- Decoding, precision, batch size, and output-normalization contract.
- Existing checkpoints or partial outputs that will be reused.
- Measured throughput from a representative probe.
- Rows assigned to each worker and the number of workers.
- Expected wall time and total accelerator-hours.
- Current hourly price with low and high total cost estimates.
- Retry allowance and the cost ceiling that stops further launches.
- Credible cheaper hardware and reuse options, plus decoding and smaller-run alternatives.
- Durable checkpoint or output interval and maximum work that can be lost.
- Pause and resume behavior plus failure-containment and completion evidence.
- The exact choice for which approval is requested.
- The measured effect, its uncertainty, and the minimum worthwhile effect when a comparison selected the method.
- The cheaper-option tie rule when the measured winner is uncertain or immaterial.

Keep wall time separate from accelerator-hours. Eight one-hour workers mean one
hour of wall time and eight accelerator-hours. Calculate fleet cost as the sum
of each worker's billed hours multiplied by its hourly price. Include setup,
finalization, and a stated retry allowance in the high estimate.

Do not infer runtime from memory. Read the source Job records and show which
model, hardware, decoding, batch size, row count, and length distribution match
the proposed run. Label every mismatch. Do not present an extrapolation as a
measurement.

## Benchmark hardware before scaling

Run one fixed, representative probe on every credible hardware option that is
available. The probe must use the proposed model, decoding, precision, batch,
input distribution, and output contract.

Record:

- Exact normalized-output agreement with the reference.
- Rows per second and measured wall time.
- Peak accelerator memory.
- Current hourly price.
- Projected dollars per million rows and full-run cost.

Choose hardware by the approved objective, usually full-run cost subject to an
acceptable wall time. Large memory capacity does not establish cost efficiency.
If a candidate cannot be tested, say why and keep its estimate separate from
measured results.

Changing hardware, precision, decoding, or batch size after approval requires a
new exactness probe and an updated cost review. Do not mix output contracts
inside one corpus merely to recover from a failed worker.

## Preserve partial outputs

A long output-producing Job must not hold all useful work on ephemeral local
storage until the end. Split work into deterministic units and publish each
completed unit durably.

Set the unit size so the maximum uncommitted work is no more than 30 minutes or
5% of the planned run, whichever is smaller. A durable unit needs:

- An immutable input index range or stable item identifiers.
- The exact input digest and output record count.
- The model and implementation contract digest.
- The normalization and serialization contract.
- A content-addressed output key with byte count and SHA-256.
- An immutable manifest that binds those fields together.

Commit a unit in this order:

1. Generate and validate the complete unit.
2. Upload its output bytes to durable storage under a content-addressed key.
3. Verify the uploaded byte count and checksum.
4. Publish the immutable unit manifest.
5. Advance durable status and then poll lifecycle control.

Only the fourth step makes progress recoverable. Logs, counters, monitoring
metrics, and status messages are not saved outputs. Never report generated rows
as recoverable until the output and manifest are both durable.

Resume by listing and validating committed manifests, rebuilding the completed
index set, and generating only missing units. A partially uploaded or
unmanifested unit is incomplete and may be regenerated. Merge must reject gaps,
overlaps, duplicate indices, mixed contract digests, and checksum failures.

For training, save every state component required by the declared resume mode.
For deterministic generation and data processing, `boundary` resume is usually
appropriate because a new process starts after the last committed unit. Use
`exact` only when uninterrupted process identity is actually proved.

## Prove pause and resume before the full run

Use `hf-job-control` for substantial Hugging Face Jobs. Before scaling out, run
a live canary that:

1. Launch the real worker on a small representative subset.
2. Commit at least two durable units.
3. Apply a cooperative pause at a safe boundary.
4. Verify the checkpoint and output manifests plus status and receipt.
5. Resume in a new physical Job.
6. Complete without missing, duplicated, or changed outputs.

Test failure recovery by interrupting one canary after a durable unit and before
the next commit. The resumed result must match an uninterrupted reference under
the declared output contract.

A platform timeout is an emergency ceiling, not a checkpoint strategy. Direct
Job cancellation is not a normal pause mechanism.

## Validate the output contract

Audit the source before launch for edge cases that can violate output or
serialization assumptions. Tests must cover examples found in the real source,
including relevant Unicode normalization, empty values, maximum lengths,
multilingual text, unusual control characters, and decomposed characters.

Apply any licensed global transformation uniformly. Record how many outputs it
changes. Do not repair individual rows silently. Run the exact producer code in
the probe and canary rather than maintaining a separate approximate test path.

Treat warnings about serialization, tied weights, model loading, precision, or
output shape as unresolved until they are explained or fixed. A repeated warning
is not harmless because previous runs happened to finish.

## Contain fleet failures

Group Jobs that share code, model state, data assumptions, and output contracts
into one failure domain. If one Job exposes a deterministic defect in that
shared contract:

1. Request cooperative pause for every affected active Job.
2. Preserve each Job's latest durable boundary.
3. Inspect whether already committed outputs remain valid.
4. Fix the shared cause and add the failing case to the test suite.
5. Rerun the probe and pause-resume canary.
6. Resume or replace the fleet only under one approved implementation contract.

Do not restart one failed shard while siblings continue running vulnerable
code. Do not merge outputs from old and corrected implementations unless the
registered contract explicitly proves them equivalent and the user approves
that mixed provenance.

Never cancel by a broad label or alter unrelated Jobs. Record every logical run,
physical Job, attempt, control generation, and terminal state.

## Stop automatic continuation

An agent may prepare code and probes plus estimates and launch specifications
without further permission. It may also run a bounded experiment whose hard
cumulative ceiling stays below $5. It must stop before other substantial paid
compute until approval is explicit.

Stop again when:

- Observed throughput makes the high cost estimate obsolete.
- The selected method changes.
- A cheaper credible option appears.
- A shared failure invalidates the worker contract.
- A retry would reach $5 in an autonomous experiment or exceed an approved cost ceiling.
- Useful checkpoints or partial outputs would be discarded.

A frozen plan does not override new cost evidence or a mistaken premise. Report
the changed facts and ask for a new decision.

## Failure pattern this prevents

A 10-million-row target-generation run once launched eight H200 Jobs at $5 per
hour without first presenting the roughly $1,000 to $1,200 projection. Each
1.25-million-row shard kept targets only on ephemeral local storage. The workers
published progress counts but no durable output chunks, so they could neither
pause nor resume and cancellation discarded all generated rows. Two shards
failed on decomposed Unicode output while siblings continued running. The
hardware choice had not been compared with cheaper GPUs, and a small decoding
gain had been selected without showing its large runtime penalty.

This entire shape is forbidden. Cost approval, representative hardware probes,
uniform output validation, durable chunks, a pause-resume canary, and fleet-wide
failure containment must precede the full launch.

## Final gate

Do not launch until every applicable statement is true:

- The launch review uses measured evidence and exact row counts.
- Any comparison-selected method passed the `practical-significance` gate.
- The user approved the current hardware, method, concurrency, and cost ceiling, or the bounded experiment has a verified cumulative ceiling below $5.
- Cheaper credible alternatives were measured or explicitly ruled out.
- Existing checkpoints and partial outputs are preserved or their removal is
  separately approved.
- Every useful unit becomes durable within the allowed loss window.
- Pause and resume passed against the real worker.
- Shared failures pause the affected fleet.
- The output contract and edge-case tests match production code.
- The launch specification and implementation digest are immutable.
- Completion can be proved from checksums and manifests plus receipts and Job state.

If any statement fails, keep the work in probe or preparation mode.
