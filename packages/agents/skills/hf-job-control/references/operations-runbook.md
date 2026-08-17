---
date: 2026-07-24
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
title: HF Job Control operations runbook
tags: [hugging-face, incidents, recovery, jobs]
---

# Operations runbook

Use this runbook when desired state, observed status, physical Job state, or
checkpoint evidence disagree. Preserve evidence before changing control or
compute.

## Incident snapshot

Collect this baseline first:

```bash
mkdir -p "incident-$RUN_ID"

hf-job-control show \
  --status-prefix "$STATUS_PREFIX" \
  "$RUN_ID" > "incident-$RUN_ID/show.json" \
  2> "incident-$RUN_ID/show.stderr" || true

hf jobs list --all --label "run_id=$RUN_ID" --format json \
  > "incident-$RUN_ID/jobs.json"

for JOB_ID in $(jq -r '.[].id // empty' "incident-$RUN_ID/jobs.json"); do
  hf jobs inspect "$JOB_ID" --format json \
    > "incident-$RUN_ID/job-$JOB_ID.json" || true
  hf jobs logs "$JOB_ID" --tail 500 --format agent \
    > "incident-$RUN_ID/job-$JOB_ID.log" || true
done

hf datasets info "$HF_JOB_CONTROL_REPO" --format json \
  > "incident-$RUN_ID/control-repo.json"
hf datasets info "$HF_JOB_STATUS_REPO" --format json \
  > "incident-$RUN_ID/status-repo.json"
hf buckets info "$HF_JOB_ARTIFACT_BUCKET" --format json \
  > "incident-$RUN_ID/artifact-bucket.json"
```

Do not include token values. Record command timestamps and the package revision
used for inspection.

## Diagnostic order

Work through these questions in order:

1. Which logical run is affected?
2. Which physical attempts and Jobs exist?
3. What is the exact desired generation and action?
4. What generation did latest observed status apply?
5. Which receipt paths exist for every attempt?
6. Which checkpoint does status reference?
7. Does that checkpoint pass outer and inner verification?
8. Is a physical Job still running?
9. Did the worker reach a safe boundary after the latest request?
10. Is a recovery action allowed by the registered project policy?

Avoid issuing a new generation merely to see whether the worker reacts. Every
generation is durable operator intent.

## Configuration errors

### Missing repository or Bucket variable

CLI output names the missing option or environment variable. Confirm the shell:

```bash
printf 'control=%s\nstatus=%s\nartifacts=%s\n' \
  "${HF_JOB_CONTROL_REPO:-}" \
  "${HF_JOB_STATUS_REPO:-}" \
  "${HF_JOB_ARTIFACT_BUCKET:-}"
```

Set the correct project resources. Do not substitute another project's status
repository or Bucket because a command happens to succeed there.

### Wrong status prefix

Symptoms include desired state appearing in `show` while observed status is
`null`, `resume` reporting no status, or `verify` reporting no checkpoint.
Inspect the worker command in the registered launch specification and physical
Job inspection. Use exactly the prefix passed to `HubStatusStore`.

```bash
hf-job-control show --status-prefix "$EXPECTED_PREFIX" "$RUN_ID"
```

Changing prefix for a later attempt changes canary command bytes and may change
a normal worker's launch environment, so the immutable launch specification
rejects it. Recover with the original prefix.

### Missing secret value at launch

The launcher reads each name from `secret_names` in explicit `secret_values` or
the local environment. CLI launches use the environment. Export the missing
secret without logging it and retry the identical launch specification.

A missing secret fails before Job creation. Launch-spec registration may already
exist and should remain unchanged.

## Creation and generation conflicts

### Run ID already exists

`create` expects generation 0. A collision means the logical ID is already
claimed. Inspect it:

```bash
hf-job-control show "$RUN_ID"
```

If it belongs to an existing run, generate a new petname for the new logical
run. Never reset or delete the old control document to reuse its name.

### Expected generation conflict

Another writer updated desired state between observation and publication. Save
the error and re-read:

```bash
hf-job-control show --status-prefix "$STATUS_PREFIX" "$RUN_ID" \
  | tee after-conflict.json
```

Identify the newer action, reason, revision, and status. Decide from that state.
Do not increment the old command and retry automatically.

### Generation moved backwards

At a boundary, this produces a safe pause decision and status message. Preserve
control and status revisions. Investigate branch force-push, wrong revision
configuration, repository restore, or a writer that bypassed the CLI.

Do not publish another command until the desired-state history is understood.
The latest numerically higher valid generation may need to be restored through
a reviewed repository operation, but never rewrite evidence casually.

### Action changed without generation

The worker pauses safely because same-generation action mutation violates the
protocol. Find the manual or faulty writer. Preserve both file versions and
repository commits. Resume only after restoring monotonic desired state through
a valid new generation and verifying paused checkpoint state.

## Launch failures

### Immutable launch specification differs

The launcher reports:

```text
immutable launch specification differs for run <run_id>
```

Fetch the registered file at exact control-repository head and compare parsed
values with the local file. Look for changes in image, command arguments,
flavor, timeout, environment, secret names, labels, or namespace.

Do not overwrite `launch-specs/<run_id>.json`. Use the original specification
for another attempt. Create a new logical run when the execution contract must
change.

### Specification registered but no Job exists

Registration happens before the Hugging Face API request. A network or service
failure can leave the immutable specification without compute.

List by logical label and Job name to make sure the launch did not succeed with
lost output:

```bash
hf jobs list --all --label "run_id=$RUN_ID" --format json
```

When no Job exists and no startup status exists, retry `launch` with the same
specification. A new attempt ID is expected.

### Launch output lost

Search physical Jobs before retrying. Compare creation time, name, labels,
command, and environment. If exactly one matching Job exists, recover its
physical ID and let it continue. If multiple Jobs exist, do not cancel broadly.
Inspect startup status and receipts to determine which attempt applied control.
Use emergency cancellation only on a confirmed duplicate.

### Launch while desired state is not run

The launcher rejects `pause`, `stop`, and `abort`. This protects terminated or
paused runs from accidental compute. For paused state, use `resume`, verify the
new `run` generation, and then launch. A stopped or aborted logical run should
normally remain terminal.

### Duplicate physical attempts

Collect every Job and attempt ID. Check status and receipts for the startup
generation. The startup rule should allow only an attempt observing a newer
control generation than status.

If two Jobs are still constructing before either writes status, the package
cannot arbitrate them yet. Cancel only the confirmed duplicate when concurrent
execution risks duplicated writes or spend. Record that cancellation was an
emergency physical action without a cooperative receipt.

### Startup generation is stale

The controller raises an error similar to:

```text
start control generation must be newer than observed status
```

This indicates replay of a generation already applied by a prior attempt. Do
not delete or roll back status. A normal paused run needs `hf-job-control
resume`, which publishes a newer generation. For another failure state, follow
the project's reviewed recovery policy. Protocol v1 has no generic restart
command for arbitrary failed status.

### Startup action is pause, stop, or abort

The controller refuses to start. Desired state changed before startup. Do not
force the worker past it. If the action was intentional, no new attempt should
run. If policy calls for continuation from a paused run, complete the proper
resume workflow.

## Running Job without healthy status

### Physical Job is RUNNING and status is absent

Inspect logs. The worker may still be installing dependencies, downloading
inputs, or constructing state before `Controller.start()`. Compare elapsed time
with measured construction gates.

Check that `RUN_ID`, `ATTEMPT_ID`, store variables, token permissions, and
network access are present. A worker that performs expensive work before
`start()` increases the ambiguity window. Integrations should construct only
what restore needs, then call `start()` before long computation.

Do not launch another attempt while the first Job remains active.

### Physical Job is RUNNING and status is stale

Compare latest boundary time with the declared maximum boundary interval. Check
logs and GPU statistics. A long application unit can be healthy even without a
new status. The worker only polls and checkpoints at boundaries.

If the interval exceeds the documented limit, inspect for deadlock, data stall,
out-of-memory recovery loops, or blocked artifact upload. A `pause` request
cannot take effect until the next boundary.

### Job logs show training but startup receipt is missing

This is an integration bug. Work began before `Controller.start()` completed or
status publication failed and the exception was ignored. Requesting pause does
not repair missing startup provenance. Preserve evidence and stop or cancel
according to project safety. Fix and re-run integration gates before production.

## Boundary failures

### Metric sink failed

The controller catches metric-sink exceptions. Status remains `running` and
contains a message such as `metric sink failed: ...`. Checkpoint and control
continue.

Repair optional monitoring separately. Do not pause solely because W&B or
another sink failed unless the project policy requires that observability.

### Adapter save failed

No complete checkpoint is available for the boundary, and control is not read.
The exception propagates. Inspect disk space, serializer error, application
state, and boundary validity. The physical Job may fail without applying a
pending pause or stop.

Use the previous verified checkpoint for recovery if project policy permits.
Do not point status or control at a partial local payload.

### Artifact upload failed

The bundle exists only in worker temporary storage and may disappear when the
process exits. Control is not read after a failed upload. Inspect Bucket
permissions, network, quota, local disk, and object key.

Retry inside application code only when the retry policy is bounded and tested.
A blind outer Job retry may replay work. Preserve logs and recover from latest
previous verified boundary.

### Status publication failed

The checkpoint may already exist in the Bucket, but current status does not
reference it. The controller raises before reading control. The content-addressed
object can be found from logs or Bucket listing, yet it should not be adopted by
manual status editing.

Record the orphaned object. Recover through a reviewed application path or the
previous status checkpoint. Add a fault test before relaunching production.

### Receipt publication failed

The controller does not advance in-memory generation until receipt publication
succeeds. It does not publish transition status or return the requested exit
decision. The application should fail because acting without a receipt would
break the protocol.

Check status repository permissions and concurrent immutable-path content. A
receipt path with different existing bytes indicates an identity or replay bug.
Do not overwrite it.

### Control fetch exhausted retries

At startup, `Controller.start()` raises `ControlError`. At a safe boundary,
`boundary()` returns a pause decision after checkpoint and running-status
publication, and transition status says control is unavailable.

The application must honor the decision, finalize, call `finish()`, and exit 0.
No receipt exists for the synthetic safe pause because no valid control snapshot
was observed. Resume after restoring control access and confirming the paused
checkpoint.

### Malformed current control

Parsing or semantic validation fails. At a boundary this follows the same safe
pause path as control unavailability. Preserve the malformed file's exact
revision and bytes.

Fix desired state through a controlled repository repair. The standard CLI may
be unable to read malformed current state, so this incident requires maintainer
review. Do not let the worker continue indefinitely and do not delete the
history.

## Pause incidents

### Pause request remains unapplied

Compare request generation with status generation. If the Job is healthy and
inside a long unit, wait for the declared next boundary. Follow logs and resource
statistics.

If the physical Job already failed, the request cannot be applied. Use the
latest verified checkpoint and project recovery policy. Desired state may still
be `pause`, so a new launch is rejected.

If waiting creates unacceptable risk, emergency cancellation is available with
loss of cooperative guarantees. Record the missing receipt.

### Status is pausing but Job continues

The worker has returned or is about to return an exit decision. Application
finalization may still be publishing large outputs. Inspect logs before taking
a physical action. A finalization timeout belongs in worker design.

### Status is paused but physical Job is RUNNING

The terminal status is written by `finish()` before process exit completes.
Allow normal cleanup briefly and inspect logs. Persistent execution after
terminal status indicates code continuing after `finish()` or blocked shutdown.
Cancel only after confirming the worker cannot exit safely on its own.

### Unsupported adapter rejected pause

Expect receipt outcome `rejected-unsupported`, transition status `aborting`,
terminal status `failed`, and exit code 1. The checkpoint may contain diagnostic
state but cannot promise resume.

Choose stop, abort, restart from immutable inputs under a new logical contract,
or implement a tested resume mode. Do not relabel the existing adapter.

## Checkpoint verification failures

### No checkpoint in status

`verify` and `resume` require latest observed status with a checkpoint. Check the
status prefix and whether the worker reached any boundary. A startup-only status
normally has no checkpoint.

### Bucket mismatch

The `ArtifactRef.bucket` differs from configured artifact Bucket. Stop. Check
operator environment and project configuration. Do not copy the artifact into
the expected Bucket and pretend the original reference was valid.

### Byte-count mismatch

The downloaded object length differs from the recorded reference. Treat the
object as corrupt or the reference as invalid. Preserve object metadata and do
not restore.

### Outer SHA-256 mismatch

The complete `.hfjob` bytes differ from the reference. Treat as corruption or
unauthorized replacement. Investigate Bucket access and publication logs.

### Archive entry mismatch

The ZIP must contain exactly `manifest.json` and `payload.bin`. Extra entries,
missing entries, duplicate naming effects, or path variants are rejected.

### Inner payload mismatch

Extracted payload bytes or digest differ from the manifest. Preserve the bundle
for incident analysis and reject restore.

### Run ID mismatch

The bundle belongs to another logical run. This is a cross-run reference error
or attempted substitution. Never bypass it.

### Adapter mismatch

Name, version, and resume mode must equal current adapter specification. Use the
worker and launch contract that created the checkpoint. A required adapter
change normally creates a new logical run.

## Resume incidents

### Resume says run is not paused

Read observed status and desired control. Resume is defined only from terminal
status `paused`. Wait for the pause to finish or investigate discrepancy. Do not
publish `run` by hand.

### Resume says paused run has no checkpoint

This is invalid terminal evidence for resumable modes. Check prefix and status
history. Preserve the inconsistency and recover through project policy.

### Resume verification succeeds but launch fails

Desired state is already a newer `run` generation with `resume_from`. The launch
spec remains registered. Search for a physical Job in case output was lost. If
none exists and no startup status for the new generation exists, retry launch
with the identical specification.

### Restore raises before startup receipt

The physical Job should fail without beginning work. Inspect adapter error,
immutable input verification, payload schema, model construction, device and
dtype placement, and framework versions.

Do not publish another resume generation blindly. The desired `run` generation
may remain newer than paused status, so another physical launch can retry only
when the failure was transient and no startup status was written. A deterministic
adapter failure requires a new reviewed execution contract.

### Resumed status lacks evidence

`adapter.restore()` returns the evidence stored in the `resumed` receipt. Empty
evidence is legal at the type level but inadequate for most production exact
resume claims. Fix the adapter to return restored boundary, global position, and
state identity. Re-run the remote pause/resume gate.

### Post-resume results diverge

Treat exactness as disproven. Compare next batch IDs, RNG outputs, optimizer and
scheduler state, scaler, accumulated gradients, data cursor, and framework
state. Downgrade the adapter mode or fix it before production.

Do not keep the `exact` label because headline metrics remain close.

## Stop and abort incidents

### Stop was issued without policy authorization

Preserve the request and do not rewrite history. The worker may still be inside
a unit. Consult the project owner immediately. A new `run` generation could
supersede the stop before the boundary, but that is another scientific decision
and needs explicit authorization.

### Stop status completed but final artifact is missing

The controller records lifecycle completion after application finalization
returns. If final artifacts are missing, the integration's finalization check is
insufficient or publication failed without propagation. The control checkpoint
may still permit forensic recovery.

Do not equate generic `completed` status with project-specific artifact
acceptance. Run the project's final artifact audit.

### Abort produces physical ERROR

This is expected when the worker exits with decision code 1. Confirm observed
status `aborted` and receipt action `abort`. Distinguish intentional abort from
an unrelated crash by evidence.

## Timeout and infrastructure interruption

### Physical timeout reached

A Hugging Face timeout can kill the worker between boundaries. Capture terminal
Job details and latest durable status. Verify latest checkpoint.

If status is `paused`, use normal resume. If latest status is `running`, protocol
v0.1 may block replayed startup generation. Use the project recovery policy and
do not delete status. Prevent recurrence by choosing a longer operational
timeout or more frequent safe boundaries in a new immutable launch contract.

### Host or service failure

Treat it similarly to timeout. Determine whether the last checkpoint and receipt
completed before failure. Physical failure alone does not invalidate a verified
prior boundary.

### Local disk exhaustion

Checkpoint creation temporarily needs application payload space plus bundle
space. ZIP storage duplicates payload bytes while building the bundle. Framework
serialization may add further temporary files.

Measure peak disk during gates. Reduce payload size through a new adapter format,
use a larger execution environment where available, or checkpoint less often
only after policy review. Never silently omit required exact state.

## Emergency cancellation

Use direct cancellation only after identifying one physical Job and preserving
state:

```bash
hf jobs inspect "$JOB_ID" --format json > "before-cancel-$JOB_ID.json"
hf jobs logs "$JOB_ID" --tail 500 --format agent > "before-cancel-$JOB_ID.log"
hf-job-control show --status-prefix "$STATUS_PREFIX" "$RUN_ID" \
  > "before-cancel-$RUN_ID.json" || true

hf jobs cancel "$JOB_ID" --format json
```

Afterward:

1. Wait for physical terminal state.
2. Re-read desired and observed state.
3. List receipts for the attempt.
4. Verify latest referenced checkpoint.
5. Mark the cancellation as a physical emergency action.
6. Record whether a pending cooperative command lacked a receipt.
7. Choose recovery from the latest verified boundary under project policy.

Never fabricate an applied-control receipt for cancellation.

## Security incident

If control, status, or artifact credentials may be compromised:

1. Stop launching new attempts.
2. Preserve exact repository heads, access logs when available, Job inspection,
   and artifact references.
3. Revoke and rotate affected tokens.
4. Audit control commits, launch specs, status commits, receipts, and Bucket
   objects.
5. Verify every referenced digest independently.
6. Treat pickle-based or executable checkpoint payloads as untrusted until
   publisher identity is established.
7. Re-run from known immutable inputs under a new logical run when provenance
   cannot be restored.

Hash equality proves byte identity with the recorded reference. It does not prove
that the writer was authorized.

## Escalation report

A useful blocked report contains:

- Logical run ID.
- Desired generation, action, exact revision, and SHA-256.
- Latest status generation, state, attempt ID, Job ID, and revision.
- Every physical Job ID and terminal stage.
- Latest boundary and checkpoint reference.
- Checkpoint verification result.
- Existing receipt paths and missing expected receipts.
- Worker package, script, model, and data revisions.
- Commands attempted and their exact errors.
- Whether any emergency cancellation occurred.
- The next decision or credential needed from the owner.

Stop when no defensible recovery path remains. Do not consume more compute to
probe an unresolved control or provenance failure.
