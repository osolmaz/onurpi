---
name: hf-job-control
description: Operate and integrate cooperative lifecycle control for detached Hugging Face Jobs with the hf-job-control Python package and CLI, including durable chunked outputs, audits, and incident recovery. Use when creating logical runs, registering immutable launch specifications, launching or monitoring physical Jobs, requesting pause/stop/abort, resuming from verified checkpoints, implementing CheckpointAdapter and Controller boundaries, making batch generation recoverable, running the remote canary, investigating control or checkpoint failures, or proving receipts and provenance for a completed run.
license: MIT
compatibility: Requires Python 3.11+, an authenticated Hugging Face account, and the hf-job-control CLI. Automatic run-ID generation also requires Node.js 22+ and npx.
metadata:
  package: hf-job-control
  repository: https://github.com/osolmaz/hf-job-control
  protocol-version: "1"
---

# HF Job Control

HF Job Control is a Python library and operator CLI for cooperative control of
detached Hugging Face Jobs. The worker reaches an application-defined safe
boundary, writes a verifiable checkpoint, publishes observed status, reads the
latest desired state, and records an immutable receipt before changing its
lifecycle.

Load the official `hf-cli` skill whenever it is available. On Onur Solmaz's
systems, also load the personal `huggingface` skill. The official skill owns
current Hugging Face CLI syntax. This skill owns the control protocol and its
safety rules.

## Task routing

Identify the role before acting. Load the matching reference completely.

| Task | Required reference |
|---|---|
| Create, launch, inspect, pause, resume, stop, abort, or verify a run | [Operator workflows](references/operator-workflows.md) |
| Add control to a worker or review a checkpoint adapter | [Worker integration](references/worker-integration.md) |
| Interpret JSON documents, repository paths, identities, states, or generations | [Protocol and storage](references/protocol-and-storage.md) |
| Diagnose a stuck, failed, stale, conflicting, or interrupted run | [Operations runbook](references/operations-runbook.md) |
| Approve a launch, action, resume, or completion | [Verification checklists](references/verification-checklists.md) |

For any task that changes live compute, read both the operator workflow and the
relevant verification checklist. For an incident, read the operations runbook
before issuing a new control generation or canceling a Job.

## Skill distribution

The Python package bundles this complete skill directory. An installed CLI can
list, display, or export it through Skillflag:

```bash
hf-job-control --skill list
hf-job-control --skill show hf-job-control
hf-job-control --skill export hf-job-control > hf-job-control-skill.tar
```

The exported tar stream includes every linked reference, schema, asset, and
agent metadata file in this directory.

## Operating boundary

The package controls cooperative application behavior. Hugging Face still owns
physical scheduling and immutable Job configuration. A running physical Job
cannot have its command, environment, image, flavor, or timeout changed.

The package does not choose a scientific stopping rule, decide that training
has converged, serialize arbitrary frameworks, or replace a workflow
orchestrator. The application owns its safe boundary, checkpoint payload, and
restore procedure. It also owns its metrics and finalization.

Keep these planes separate:

- The control dataset stores desired state and immutable launch specifications.
- The status dataset stores observed status and immutable applied-control
  receipts.
- The artifact Bucket stores large content-addressed checkpoint bundles.
- The physical Hugging Face Job supplies compute, logs, resource statistics,
  and its server-assigned `JOB_ID`.
- Optional systems such as W&B receive monitoring metrics only.

A control commit is a request. Status and receipts prove what the worker did.
Never report a pause, stop, abort, or resume as applied from desired state alone.

## Hard invariants

Follow every invariant below for every controlled run.

1. Generate one logical `run_id` for a new run and reuse it across all physical
   attempts. Each attempt gets a new `attempt_id` and a new Hugging Face Job ID.
2. Register one immutable launch specification per logical run. Every later
   attempt must match its canonical JSON bytes.
3. Put secret names in the launch specification and secret values in the local
   environment. Never store secret values in JSON, logs, receipts, labels, or
   command output.
4. Set an explicit Hugging Face Job timeout and treat it as an operational
   safety limit. It does not define the scientific horizon.
5. Poll control only at a declared safe boundary after the checkpoint and
   observed status are durable.
6. Write the applied-control receipt before acting on the command.
7. Never overwrite a content-addressed Bucket key or immutable receipt.
8. Resume a logical run in a new physical Job. Do not describe a terminated
   Hugging Face Job as resumed in place.
9. Use `--expected-generation` for mutations whenever another operator or
   process could update the same run.
10. Preserve the registered scientific policy outside this package. An
    operator-selected `stop` may end an open observation window only when the
    experiment plan already authorizes that decision.
11. If control remains unavailable at a safe boundary, finish through the safe
    pause path. Do not let open-ended work continue without its control plane.
12. Use `hf jobs cancel` only for an emergency where waiting for the next safe
    boundary creates more risk than losing checkpoint and receipt guarantees.
13. Inspect active Jobs before launching or canceling. Filter by `run_id` and
    never alter an unrelated Job.
14. Verify the exact checkpoint before publishing resume. Verify the resulting
    start receipt and adapter restore evidence before claiming resume success.
15. Keep package, worker script, input revisions, launch specification, and
    checkpoint adapter identity immutable for a resumable attempt series.
16. For output-producing workers, persist output bytes and their immutable
    manifests before reporting the boundary as recoverable. A row counter or
    status update without durable output is not a checkpoint.

## Required environment

Prefer environment variables so commands remain short and reproducible:

```bash
export HF_JOB_CONTROL_REPO="owner/jobs-control"
export HF_JOB_STATUS_REPO="owner/project-status"
export HF_JOB_ARTIFACT_BUCKET="owner/job-artifacts"
export HF_TOKEN="$(hf auth token)"
```

Do not print `HF_TOKEN`, place it in shell tracing, or pass it as a normal launch
environment value. Use `secret_names: ["HF_TOKEN"]` in a launch specification.

The CLI resolves these variables when the matching explicit option is absent:

| Variable | CLI option | Used by |
|---|---|---|
| `HF_JOB_CONTROL_REPO` | `--control-repo` | `create`, `show`, lifecycle mutations, `launch`, `canary` |
| `HF_JOB_STATUS_REPO` | `--status-repo` | `show`, `watch`, `resume`, `verify`, `canary` |
| `HF_JOB_ARTIFACT_BUCKET` | `--artifact-bucket` | `resume`, `verify`, `canary` |

The worker receives `RUN_ID` and `ATTEMPT_ID` from `hf-job-control launch`.
Hugging Face supplies `JOB_ID`. Do not put `RUN_ID` or `ATTEMPT_ID` in the
launch specification's `environment` object because the launcher owns them.

## Preflight

Run this read-only preflight before creating or changing live state:

```bash
hf auth whoami --format json
hf version --format json
hf-job-control --help
hf datasets info "$HF_JOB_CONTROL_REPO" --format json
hf datasets info "$HF_JOB_STATUS_REPO" --format json
hf buckets info "$HF_JOB_ARTIFACT_BUCKET" --format json
hf jobs list --all --limit 100 --format json
```

Confirm the authenticated namespace, resource privacy, package version,
available hardware, current Jobs, repository permissions, and intended status
prefix. Inspect the project plan and submitted worker before choosing `stop` or
`abort`.

When a run already exists, capture exact state before mutation:

```bash
hf-job-control show \
  --status-prefix runs \
  "$RUN_ID" | tee "show-$RUN_ID-before.json"

hf jobs list --all --label "run_id=$RUN_ID" --format json \
  | tee "jobs-$RUN_ID-before.json"
```

Use the generation from the saved `show` output as
`--expected-generation`. Re-read state after any conflict.

## Lifecycle

The desired actions and observed outcomes have distinct meanings.

| Requested action | Worker behavior at the next boundary | Normal terminal state | Exit code |
|---|---|---|---|
| `run` | Save checkpoint, remain eligible to continue | `running` | Continue |
| `pause` | Save checkpoint and end this attempt for later resume | `paused` | `0` |
| `stop` | Save checkpoint, finalize the logical run, and end cleanly | `completed` | `0` |
| `abort` | Save diagnostic state when possible and end as aborted | `aborted` | `1` |

`pause` preserves the option to continue. `stop` closes the logical run under
its registered policy. `abort` records an unsuccessful outcome. The package
uses an exit code of `1` when an adapter with `unsupported` resume mode rejects
a pause.

Intermediate observed states include `pausing`, `stopping`, and `aborting`.
Wait for the terminal status and physical Job result before reporting the final
outcome.

## Standard operator sequence

Create a logical run:

```bash
RUN_JSON="$(hf-job-control create --reason "Start registered workload")"
printf '%s\n' "$RUN_JSON" | tee create.json
RUN_ID="$(printf '%s' "$RUN_JSON" | jq -r '.control.run_id')"
GENERATION="$(printf '%s' "$RUN_JSON" | jq -r '.control.generation')"
```

Validate and retain the launch specification in source control or an immutable
project artifact. A complete example lives at
[launch-spec.example.json](assets/launch-spec.example.json).

Launch one physical attempt:

```bash
hf-job-control launch "$RUN_ID" launch-spec.json | tee launch.json
JOB_ID="$(jq -r '.job_id' launch.json)"
ATTEMPT_ID="$(jq -r '.attempt_id' launch.json)"

hf jobs inspect "$JOB_ID" --format json
hf jobs logs "$JOB_ID" --tail 100 --format agent
```

Observe durable state:

```bash
hf-job-control show --status-prefix runs "$RUN_ID"
hf-job-control watch --status-prefix runs --timeout 86400 "$RUN_ID"
```

`watch` reads project status. Use `hf jobs inspect`, `logs`, and `stats` for the
physical attempt. A running Hugging Face Job without fresh durable status is a
reason to investigate.

Request a cooperative pause:

```bash
hf-job-control pause \
  --expected-generation "$GENERATION" \
  --reason "Release the worker after its next safe checkpoint" \
  "$RUN_ID" | tee pause-request.json
```

After status becomes `paused`, verify the checkpoint and then resume:

```bash
hf-job-control verify --status-prefix runs "$RUN_ID" | tee verify.json

PAUSE_GENERATION="$(jq -r '.control.generation' pause-request.json)"
hf-job-control resume \
  --status-prefix runs \
  --expected-generation "$PAUSE_GENERATION" \
  --reason "Continue from the verified pause boundary" \
  "$RUN_ID" | tee resume-request.json

hf-job-control launch "$RUN_ID" launch-spec.json | tee resumed-launch.json
```

The resumed launch must reuse the original launch specification. Verify its new
physical IDs, startup receipt, restored boundary, and adapter restore evidence.

Request a clean stop only when the registered policy permits it:

```bash
CURRENT_GENERATION="$(hf-job-control show "$RUN_ID" | jq -r '.control.generation')"
hf-job-control stop \
  --expected-generation "$CURRENT_GENERATION" \
  --reason "Registered stopping condition reached" \
  "$RUN_ID"
```

Use the operator reference for full command behavior, race handling, canary
operation, and post-action verification.

## Worker contract

A worker constructs a job-specific `CheckpointAdapter`, calls
`Controller.start(adapter)` once, and calls `Controller.boundary(...)` only at a
safe point. If the returned decision requests exit, the application finalizes
its own outputs and calls `Controller.finish(decision)`.

The controller's boundary order is fixed:

1. Publish optional metrics, isolating metric-sink failures.
2. Ask the adapter to write `payload.bin`.
3. Build a two-entry `.hfjob` ZIP bundle and hash its payload.
4. Upload the bundle under a content-addressed Bucket key.
5. Publish observed `running` status with boundary and checkpoint plus metrics.
6. Fetch and validate control with bounded retries.
7. Publish a receipt for a newly applied generation.
8. Publish the transition state and return a typed decision.

The application must finalize outputs before calling `finish()`. It must exit
with `decision.exit_code`. A caller that ignores `should_exit` breaks lifecycle
semantics even though the control receipt exists.

Read [Worker integration](references/worker-integration.md) before writing or
reviewing an adapter.

### Durable output boundaries

For batch inference, dataset construction, media processing, and other
output-producing Jobs, the checkpoint adapter must describe committed output
units rather than merely recording a cursor. Upload each unit's bytes before
publishing the boundary checkpoint.

A committed unit records stable input IDs or an index range, record count,
input digest, output key, byte count, output SHA-256, and the complete producer
contract digest. The producer contract covers model and code revisions plus
decoding, precision, batch size, normalization, and serialization. Store large
output bytes in the artifact Bucket and bind them through immutable unit
manifests.

The checkpoint payload contains the ordered committed-unit manifests or a
content-addressed manifest index. Restore verifies every referenced unit,
rebuilds the completed input set, and processes only missing units. Merge
rejects gaps, overlaps, mixed producer contracts, and checksum failures.

Commit in this order:

1. Generate and validate one complete unit.
2. Upload its output bytes and verify the remote checksum.
3. Publish its immutable unit manifest.
4. Write the adapter checkpoint containing that manifest.
5. Publish observed status, then poll control.

A direct cancel may lose the current uncommitted unit, but it must not lose
previous committed units. Choose the unit size under the loss window required by
`paid-compute-launch`. Before a large fleet launch, prove boundary resume with a
real pause after multiple units and verify that resumed output matches an
uninterrupted reference.

## Resume modes

Choose the strongest mode the adapter can prove.

| Mode | Promise | `resume` behavior |
|---|---|---|
| `exact` | Subsequent execution matches uninterrupted execution from the boundary | Publishes `run` with `resume_from`; the new worker restores it |
| `boundary` | Work resumes from the last committed unit without process-level identity | Publishes `run` with `resume_from`; the adapter restores the committed boundary |
| `restart` | Repeating immutable inputs is the recovery method | Verifies the pause checkpoint, then publishes `run` without `resume_from` |
| `unsupported` | The application cannot safely pause or resume | Rejects pause and rejects CLI resume |

An exact PyTorch adapter usually includes model parameters, optimizer state,
scheduler state, gradient scaler when used, Python RNG, Torch CPU and CUDA RNG,
sampler or shuffle state, data position, global step, accumulated-gradient
position, model-selection state, patience counters, and any framework state that
changes subsequent computation.

Test exact resume by comparing a paused-and-resumed execution to an uninterrupted
reference after additional work. Compare future losses, model and optimizer
state, scheduler state, RNG outputs, data order, and counters.

## Evidence standard

A successful lifecycle operation needs evidence from all applicable surfaces:

- Desired control JSON with exact dataset revision and SHA-256.
- Immutable launch specification with exact revision and SHA-256.
- Observed status showing the applied generation and physical attempt.
- Immutable receipt for that attempt and generation.
- Content-addressed checkpoint reference with Bucket and key plus exact bytes
  and SHA-256.
- Verified inner checkpoint manifest with adapter identity and boundary.
- Hugging Face Job identity and labels plus stage, logs, and terminal result.
- Adapter restore evidence for a resumed attempt.
- Project-specific metrics, output manifests, and submitted-code digests.

A mutable repository head is insufficient provenance. Record the exact commit
returned by each publication.

## Canary requirement

Run the remote CPU canary before adopting the package in a new account,
resource layout, authentication setup, or release. Exercise create and pause through verified resume and a second launch. Then
exercise stop and abort. Confirm separate attempt and Job IDs plus immutable
receipts for each applied generation.

The canary has a finite `max-boundaries` safety ceiling. It must receive a
cooperative lifecycle command before that ceiling or it exits with an error.
The full procedure is in [Operator workflows](references/operator-workflows.md).

## Emergency cancellation

A direct cancellation can interrupt an optimizer step, upload, status commit,
or receipt write. Before cancellation, save the current desired state, observed
status, Job inspection, and recent logs. Cancel only the identified physical
Job:

```bash
hf jobs inspect "$JOB_ID" --format json
hf jobs cancel "$JOB_ID" --format json
```

After cancellation, inspect whether a usable checkpoint and receipt already
exist. Do not manufacture a receipt or claim an action was cooperatively
applied. Follow the cancellation recovery section in the operations runbook.

## Forbidden shortcuts

- Do not hand-edit `controls/<run_id>.json`.
- Do not update control without advancing `generation`.
- Do not reuse a logical `run_id` for a new experiment.
- Do not generate a new logical ID when resuming the same run.
- Do not launch while desired state is `pause`, `stop`, or `abort`.
- Do not change the launch specification between attempts.
- Do not put `RUN_ID`, `ATTEMPT_ID`, or secret values in launch JSON.
- Do not call `boundary()` before application state is safe to serialize.
- Do not describe `restart` as exact or boundary resume.
- Do not treat W&B, stdout, or Job stage as the authoritative control record.
- Do not delete a checkpoint referenced by current status or a receipt.
- Do not retry a mutation blindly after a generation conflict.
- Do not cancel Jobs by broad filters or alter unrelated labels.
- Do not use a platform timeout as the experiment's convergence criterion.

## Completion

Before declaring work finished, run the matching checklist and report exact
identifiers. At minimum, include the logical run ID, all physical Job IDs,
terminal observed state, final applied generation, launch-spec digest, latest
checkpoint digest, receipt paths, and any restore evidence. State plainly when
a surface is unavailable or unverified.

For a package or integration change, run local deterministic resume tests and
the repository quality gates. A new worker integration also needs its own CPU
construction test, finite-work test, checkpoint round trip, interrupted/resumed
comparison, and remote canary before expensive compute starts.
