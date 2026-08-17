---
date: 2026-07-24
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
title: HF Job Control operator workflows
tags: [hugging-face, jobs, operations, checkpoints]
---

# Operator workflows

This guide covers the current `hf-job-control` v0.1 CLI. Check the installed
command before acting because a checked-out repository, a worker image, and the
operator machine may contain different package revisions.

```bash
command -v hf-job-control
hf-job-control --help
python -c 'import importlib.metadata; print(importlib.metadata.version("hf-job-control"))'
hf version --format json
```

## Installation and authentication

Install an exact release version. Use the same package version in workers and
operator tests, and record the published wheel digest with the run evidence.

```bash
uv tool install hf-job-control==<version>
hf-job-control --skill list
hf auth whoami --format json
```

A Git commit can be used while testing an unreleased change:

```bash
uv tool install \
  "hf-job-control @ git+https://github.com/osolmaz/hf-job-control@<commit>"
```

Automatic run-ID generation invokes `npx --yes @osolmaz/petname`. Install
Node.js 22 or newer, or generate a petname separately and pass `--run-id`.

```bash
RUN_ID="$(npx --yes @osolmaz/petname)"
hf-job-control create --run-id "$RUN_ID" --reason "Start registered workload"
```

Never paste a token into a command that will enter shell history. Prefer the
Hugging Face credential store. A worker launch that lists `HF_TOKEN` under
`secret_names` reads the value from the operator environment.

## Resource provisioning

A controlled deployment needs two private dataset repositories and one private
Bucket. The project may use a dedicated status dataset or a shared project
evidence dataset with a unique prefix.

```bash
export HF_JOB_CONTROL_REPO="owner/jobs-control"
export HF_JOB_STATUS_REPO="owner/project-status"
export HF_JOB_ARTIFACT_BUCKET="owner/jobs-artifacts"

hf repos create "$HF_JOB_CONTROL_REPO" \
  --type dataset --private --exist-ok --format json
hf repos create "$HF_JOB_STATUS_REPO" \
  --type dataset --private --exist-ok --format json
hf buckets create "$HF_JOB_ARTIFACT_BUCKET" \
  --private --exist-ok --format json
```

Inspect existing resources before provisioning. `--exist-ok` prevents an
existing resource from being replaced, but it does not prove that the resource
has the required privacy or ownership.

```bash
hf datasets info "$HF_JOB_CONTROL_REPO" --format json
hf datasets info "$HF_JOB_STATUS_REPO" --format json
hf buckets info "$HF_JOB_ARTIFACT_BUCKET" --format json
```

Grant the worker token the minimum permissions needed to read control, write
status and receipts, and read or write its artifact Bucket. Keep control and
status repositories private when they include operational metadata.

## Configuration

Set all three resource variables in the operator shell:

```bash
export HF_JOB_CONTROL_REPO="owner/jobs-control"
export HF_JOB_STATUS_REPO="owner/project-status"
export HF_JOB_ARTIFACT_BUCKET="owner/jobs-artifacts"
```

Choose one status prefix and keep it fixed for the logical run. The default is
`runs`. A project can use a longer path such as
`programs/my-program/controlled-runs`.

```bash
STATUS_PREFIX="programs/my-program/controlled-runs"
```

Every `show`, `watch`, `resume`, `verify`, and `canary` command for that run
must use the same prefix. The prefix is part of a canary's immutable launch
specification because it appears in the worker command.

## Logical run creation

A new logical run begins at generation 1 with desired action `run`.

```bash
CREATE_JSON="$(hf-job-control create --reason "Start approved run")"
printf '%s\n' "$CREATE_JSON" | tee create.json
RUN_ID="$(jq -r '.control.run_id' create.json)"
GENERATION="$(jq -r '.control.generation' create.json)"
CONTROL_REVISION="$(jq -r '.revision' create.json)"
CONTROL_SHA256="$(jq -r '.sha256' create.json)"
```

Store `RUN_ID` once. Reuse it after pauses, launch failures, infrastructure
interruptions, and exact resume. Generate a new run ID when scientific inputs,
execution contract, or intended logical outcome define a new run.

A supplied ID must match this safe path-component pattern:

```text
^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$
```

The sortable petname format is recommended:

```text
YYYYMMDDHHmm-adjective-animal
```

Creation uses optimistic concurrency with expected generation 0. It fails if a
control document already exists for the ID.

## Launch specification

The launch specification is the immutable execution contract for every physical
attempt under a logical run. Start from
[`../assets/launch-spec.example.json`](../assets/launch-spec.example.json).

Required keys are:

- `schema_version`, currently `1`.
- `image`, the complete container image reference.
- `command`, a non-empty array of command arguments.
- `flavor`, the Hugging Face hardware flavor.
- `timeout`, an explicit operational timeout such as `2h` or `24h`.
- `environment`, string-valued non-secret variables.
- `secret_names`, names whose values are read locally at launch.
- `labels`, string-valued additional labels.

`namespace` is optional. The launcher always adds `RUN_ID` and `ATTEMPT_ID` to
the environment. It always adds `run_id` and `attempt_id` labels and uses the
logical run ID as the Hugging Face Job name.

Do not place either injected identity in `environment`. Do not put secret values
in the file. Use an immutable image digest, script URL revision, git commit,
wheel digest, model revision, and data revision wherever the workload allows.
The package compares canonical JSON bytes on later launches, so key order and
formatting of the local file do not matter after parsing. Values must remain
identical.

Validate JSON and retain its digest before launch:

```bash
python -m json.tool launch-spec.json >/dev/null
sha256sum launch-spec.json
```

The local file digest may differ from the registered digest when whitespace or
key order differs. The registered document uses sorted, indented canonical JSON
with a final newline. Fetch and record the launch result, then inspect
`launch-specs/<run_id>.json` at the exact returned control-repository revision
when canonical provenance is required.

## First launch

The current desired action must be `run`.

```bash
hf-job-control show "$RUN_ID" | tee before-launch.json
jq -e '.control.action == "run"' before-launch.json

hf-job-control launch "$RUN_ID" launch-spec.json | tee launch.json
JOB_ID="$(jq -r '.job_id' launch.json)"
ATTEMPT_ID="$(jq -r '.attempt_id' launch.json)"
```

The first launch registers `launch-specs/<run_id>.json` before asking Hugging
Face to create the Job. A launch API failure can therefore leave a registered
specification with no physical Job. This is safe. Retry with the same file.

The launcher returns:

```json
{
  "attempt_id": "attempt-...",
  "job_id": "server-assigned-id",
  "run_id": "logical-run-id",
  "url": "https://huggingface.co/jobs/..."
}
```

Confirm that no duplicate physical attempt already exists:

```bash
hf jobs list --all --label "run_id=$RUN_ID" --format json
hf jobs inspect "$JOB_ID" --format json
hf jobs logs "$JOB_ID" --tail 100 --format agent
```

If launch output was lost after the API succeeded, list by exact `run_id` label
before retrying. A blind retry can create a second physical attempt when no
observed status exists yet.

## Startup verification

A healthy worker publishes a startup receipt and `running` status only after
`Controller.start()` validates current desired state. For a fresh attempt, the
receipt outcome is `started`. For resume, it is `resumed` and includes adapter
evidence.

```bash
hf-job-control show \
  --status-prefix "$STATUS_PREFIX" \
  "$RUN_ID" | tee started.json

jq '{control, status}' started.json
hf jobs inspect "$JOB_ID" --format json
```

Verify all of the following:

- Status `attempt_id` and `job_id` match the launch.
- Status state is `running`.
- `last_applied_generation` equals current desired generation.
- `last_action` is `run`.
- The generation receipt exists under the expected attempt path.
- Resume evidence is present when `resume_from` was supplied.

A Job at physical stage `RUNNING` without startup status may still be installing
or constructing. Use logs and a workload-specific construction deadline. If it
passes that deadline, investigate before issuing another launch.

## Observation

`show` prints exact desired state. It adds observed status when a status
repository is configured.

```bash
hf-job-control show \
  --status-prefix "$STATUS_PREFIX" \
  "$RUN_ID"
```

`watch` prints status whenever its canonical JSON changes and exits when it sees
`paused`, `completed`, `aborted`, or `failed`.

```bash
hf-job-control watch \
  --status-prefix "$STATUS_PREFIX" \
  --interval 10 \
  --timeout 86400 \
  "$RUN_ID"
```

`watch` does not replace physical Job inspection:

```bash
hf jobs inspect "$JOB_ID" --format json
hf jobs logs "$JOB_ID" --tail 200 --format agent
hf jobs stats "$JOB_ID" --format json
```

The status dataset is authoritative for cooperative action. Hugging Face Job
stage is authoritative for physical execution. Compare both.

## Mutation discipline

Before every lifecycle mutation, save current desired and observed state:

```bash
hf-job-control show \
  --status-prefix "$STATUS_PREFIX" \
  "$RUN_ID" | tee before-mutation.json
GENERATION="$(jq -r '.control.generation' before-mutation.json)"
```

Pass that exact generation:

```bash
hf-job-control pause \
  --expected-generation "$GENERATION" \
  --reason "Operational pause at the next safe boundary" \
  "$RUN_ID"
```

Without `--expected-generation`, the CLI reads current generation and attempts
the next value. That remains concurrency-safe at commit time, but an explicit
expected generation makes operator intent auditable and prevents acting on a
state that changed after review.

If a mutation reports an expected-generation conflict, stop. Re-run `show`,
determine who changed desired state, and decide from the new evidence. Do not
repeat the old command with a higher number automatically.

Protocol v1 has no mutable epoch, step, or scientific-limit field. Change
scientific policy in the project plan and worker as a new logical execution
contract. Do not invent fields in control JSON.

## Pause

A pause request creates the next control generation. The running worker sees it
only at its next safe boundary.

```bash
hf-job-control pause \
  --expected-generation "$GENERATION" \
  --reason "Release hardware after the next durable checkpoint" \
  "$RUN_ID" | tee pause-request.json
PAUSE_GENERATION="$(jq -r '.control.generation' pause-request.json)"
```

Watch for terminal status:

```bash
hf-job-control watch \
  --status-prefix "$STATUS_PREFIX" \
  --timeout 86400 \
  "$RUN_ID" | tee pause-watch.json
```

A normal pause ends with observed state `paused`, exit code 0, a latest
checkpoint, a generation receipt, and a terminal physical Job. Verify those
surfaces before releasing the checkpoint or announcing success.

An adapter with resume mode `unsupported` rejects pause. It writes a
`rejected-unsupported` receipt and finishes failed with exit code 1. Do not
retry pause against the same adapter.

## Checkpoint verification

`verify` reads latest status, downloads its checkpoint from the configured
Bucket, checks outer digest and byte count, validates the two-entry ZIP, and
parses the inner manifest.

```bash
hf-job-control verify \
  --status-prefix "$STATUS_PREFIX" \
  "$RUN_ID" | tee verified-checkpoint.json

jq -e '.verified == true' verified-checkpoint.json
jq '.manifest | {run_id, attempt_id, adapter, boundary, payload_sha256, payload_bytes}' \
  verified-checkpoint.json
```

Verification does not execute the application's restore code. The resumed
worker performs adapter identity checks, inner payload hashing, and restore.
Exact resume also requires a deterministic continuation test maintained by the
worker project.

## Resume

Resume requires observed state `paused` and a latest checkpoint. The CLI always
verifies the checkpoint before publishing a new `run` generation.

```bash
hf-job-control show \
  --status-prefix "$STATUS_PREFIX" \
  "$RUN_ID" | tee paused.json

jq -e '.status.state == "paused"' paused.json
PAUSE_GENERATION="$(jq -r '.control.generation' paused.json)"

hf-job-control resume \
  --status-prefix "$STATUS_PREFIX" \
  --expected-generation "$PAUSE_GENERATION" \
  --reason "Continue from the verified boundary" \
  "$RUN_ID" | tee resume-request.json
```

For `exact` and `boundary`, new desired state includes `resume_from`. For
`restart`, the CLI verifies the checkpoint and publishes `run` without
`resume_from`. `unsupported` produces an error.

Launching is a separate step:

```bash
hf-job-control launch "$RUN_ID" launch-spec.json | tee resumed-launch.json
NEW_JOB_ID="$(jq -r '.job_id' resumed-launch.json)"
NEW_ATTEMPT_ID="$(jq -r '.attempt_id' resumed-launch.json)"
```

Use the identical launch specification. A different timeout, label, environment
value, command argument, image, namespace, flavor, or secret-name list is
rejected.

After startup, inspect the new generation receipt. Exact and boundary resume
must report outcome `resumed`, the requested checkpoint, restored boundary, and
adapter-provided evidence. The physical Job ID and attempt ID must differ from
the paused attempt.

## Stop

Use `stop` when the run should complete successfully at its next safe boundary.
The project policy must already authorize operator-selected stopping when the
choice affects scientific results.

```bash
hf-job-control show \
  --status-prefix "$STATUS_PREFIX" \
  "$RUN_ID" | tee before-stop.json
GENERATION="$(jq -r '.control.generation' before-stop.json)"

hf-job-control stop \
  --expected-generation "$GENERATION" \
  --reason "Registered completion condition reached" \
  "$RUN_ID" | tee stop-request.json

hf-job-control watch \
  --status-prefix "$STATUS_PREFIX" \
  --timeout 86400 \
  "$RUN_ID"
```

A normal stop ends with status `completed` and exit code 0. The final boundary
checkpoint remains available for audit. Application-specific final outputs may
be separate from the control checkpoint and need their own verification.

## Abort

Use `abort` to record an unsuccessful logical run at the next safe boundary.
It requests diagnostic checkpointing before the process exits nonzero.

```bash
hf-job-control show \
  --status-prefix "$STATUS_PREFIX" \
  "$RUN_ID" | tee before-abort.json
GENERATION="$(jq -r '.control.generation' before-abort.json)"

hf-job-control abort \
  --expected-generation "$GENERATION" \
  --reason "Invalid input discovered; preserve diagnostic state" \
  "$RUN_ID" | tee abort-request.json
```

Expect terminal status `aborted`, an abort receipt, a checkpoint when the worker
reaches its boundary, and physical Job failure caused by exit code 1. This
nonzero result is intentional.

## Remote CPU canary

The canary uses the same control, status, artifact, launch, receipt, and resume
paths as a real integration. Pin `--package-ref` to a tag or commit. Use the
same arguments for every physical attempt under one canary run.

Create and launch:

```bash
PACKAGE_REF="hf-job-control @ git+https://github.com/osolmaz/hf-job-control@<commit>"
STATUS_PREFIX="canary-runs"

CREATE_JSON="$(hf-job-control create --reason "Exercise pause and resume")"
RUN_ID="$(printf '%s' "$CREATE_JSON" | jq -r '.control.run_id')"

hf-job-control canary \
  --status-prefix "$STATUS_PREFIX" \
  --package-ref "$PACKAGE_REF" \
  --interval 5 \
  --max-boundaries 120 \
  --job-timeout 15m \
  "$RUN_ID" | tee canary-first-launch.json
```

Pause it:

```bash
GENERATION="$(printf '%s' "$CREATE_JSON" | jq -r '.control.generation')"
hf-job-control pause \
  --expected-generation "$GENERATION" \
  --reason "Canary pause" \
  "$RUN_ID"

hf-job-control watch \
  --status-prefix "$STATUS_PREFIX" \
  --timeout 900 \
  "$RUN_ID"

hf-job-control verify --status-prefix "$STATUS_PREFIX" "$RUN_ID"
```

Resume and launch a new physical attempt:

```bash
PAUSE_GENERATION="$(hf-job-control show "$RUN_ID" | jq -r '.control.generation')"
hf-job-control resume \
  --status-prefix "$STATUS_PREFIX" \
  --expected-generation "$PAUSE_GENERATION" \
  --reason "Canary resume" \
  "$RUN_ID"

hf-job-control canary \
  --status-prefix "$STATUS_PREFIX" \
  --package-ref "$PACKAGE_REF" \
  --interval 5 \
  --max-boundaries 120 \
  --job-timeout 15m \
  "$RUN_ID" | tee canary-resumed-launch.json
```

Stop the resumed attempt:

```bash
RUN_GENERATION="$(hf-job-control show "$RUN_ID" | jq -r '.control.generation')"
hf-job-control stop \
  --expected-generation "$RUN_GENERATION" \
  --reason "Canary stop" \
  "$RUN_ID"

hf-job-control watch \
  --status-prefix "$STATUS_PREFIX" \
  --timeout 900 \
  "$RUN_ID"
```

Verify separate physical IDs and confirm restore evidence shows the paused
counter value. Inspect every receipt.

Test abort with a separate logical run because stop already completed the first
one:

```bash
ABORT_JSON="$(hf-job-control create --reason "Exercise abort")"
ABORT_RUN_ID="$(printf '%s' "$ABORT_JSON" | jq -r '.control.run_id')"

hf-job-control canary \
  --status-prefix "$STATUS_PREFIX" \
  --package-ref "$PACKAGE_REF" \
  --interval 5 \
  --max-boundaries 120 \
  --job-timeout 15m \
  "$ABORT_RUN_ID" | tee canary-abort-launch.json

hf-job-control abort \
  --expected-generation 1 \
  --reason "Canary abort" \
  "$ABORT_RUN_ID"
```

The abort Job should terminate with a nonzero physical result and durable
observed state `aborted`.

## Open-ended work

An open-ended worker omits its own scientific epoch cap only when a registered
plan authorizes operator control of the observation horizon. Use a
horizon-independent scheduler. Publish training-only metrics at each safe
boundary. The platform launch specification still requires an explicit timeout.
If that timeout interrupts the physical attempt, resume the same logical run
from verified state.

The v1 control document cannot alter an epoch limit. It carries lifecycle only.
Do not hand-add `max_epochs` or other policy fields because strict validation
rejects unknown keys.

## Bounded work

A bounded worker keeps its hard limit in immutable worker code or configuration.
The controller may still pause, stop, or abort at safe boundaries. Natural
completion without a lifecycle decision remains application-owned. The worker
should publish its final project artifacts and a terminal status consistent
with its integration design.

## Physical Job commands

Use Hugging Face commands to inspect one physical attempt:

```bash
hf jobs inspect "$JOB_ID" --format json
hf jobs logs "$JOB_ID" --tail 200 --format agent
hf jobs stats "$JOB_ID" --format json
hf jobs wait "$JOB_ID" --timeout 24h --format json
```

`hf jobs stats` streams until interrupted in some CLI versions. Run it in a
controlled terminal and stop it after collecting enough evidence.

Filter by logical run ID when recovering lost local launch output:

```bash
hf jobs list --all --label "run_id=$RUN_ID" --format json
```

Do not infer the logical lifecycle from physical Job stage alone. A physical
Job can fail before writing status, while a cooperative abort intentionally
produces a nonzero physical result.

## Completion audit

Before closing a run, collect:

```bash
hf-job-control show --status-prefix "$STATUS_PREFIX" "$RUN_ID" > final-show.json
hf-job-control verify --status-prefix "$STATUS_PREFIX" "$RUN_ID" > final-verify.json
hf jobs list --all --label "run_id=$RUN_ID" --format json > final-jobs.json
```

Then verify receipt count and content directly in the status dataset. Record the
exact repository revisions used for the audit. The final report should include
the logical run ID, final generation and action, observed terminal state,
launch-spec digest, every attempt and Job ID, the final checkpoint reference,
receipt paths, and restore evidence.
