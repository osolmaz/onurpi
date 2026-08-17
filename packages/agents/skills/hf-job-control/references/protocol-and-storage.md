---
date: 2026-07-24
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
title: HF Job Control protocol and storage
tags: [hugging-face, protocol, json, storage, provenance]
---

# Protocol and storage

Protocol v1 separates requested lifecycle state, observed lifecycle state,
immutable execution configuration, and large checkpoint bytes. This separation
lets an auditor distinguish an operator request from worker evidence.

The authoritative JSON Schemas ship in the repository root under `schemas/`.
The skill carries matching copies for
[control](schemas/control-v1.schema.json),
[launch specifications](schemas/launch-spec-v1.schema.json),
[status](schemas/run-status-v1.schema.json),
[receipts](schemas/applied-control-v1.schema.json), and
[checkpoint manifests](schemas/checkpoint-manifest-v1.schema.json). The Python
domain models apply additional semantic checks.

## Identities

A controlled execution uses three identifiers.

| Identity | Lifetime | Assigned by | Example |
|---|---|---|---|
| Logical `run_id` | All retries and resumes for one logical outcome | Operator, usually through `@osolmaz/petname` | `202607241430-calm-otter` |
| Physical `attempt_id` | One submitted worker attempt | `hf-job-control launch` or operator override | `attempt-8f…` |
| Physical `job_id` | One Hugging Face Job | Hugging Face | `6a631c…` |

The launcher's Job name is the logical run ID. It adds `run_id` and
`attempt_id` labels, injects `RUN_ID` and `ATTEMPT_ID`, and records Hugging
Face's `JOB_ID` in status and receipts when the platform provides it.

A logical ID must match:

```text
^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$
```

Attempt IDs use the same safe-component constraints. Repository and Bucket IDs
must use `namespace/name` form.

## Storage map

The control dataset contains desired state and immutable launch specifications:

```text
controls/<run_id>.json
launch-specs/<run_id>.json
```

The status dataset uses a configurable prefix, defaulting to `runs`:

```text
<prefix>/<run_id>/status.json
<prefix>/<run_id>/attempts/<attempt_id>/receipts/generation-<generation:08d>.json
```

The artifact Bucket stores checkpoint bundles:

```text
<run_id>/checkpoints/sha256-<bundle-sha256>/checkpoint.hfjob
```

The control and status stores are Git-backed Hugging Face dataset repositories.
Every read resolves a branch to an exact commit before downloading a file. The
artifact Bucket has no Git history, so object keys include content digests and
are treated as immutable.

## Canonical JSON

The package serializes protocol documents with:

```python
json.dumps(
    value,
    allow_nan=False,
    indent=2,
    sort_keys=True,
    ensure_ascii=False,
) + "\n"
```

This format gives stable bytes and a stable SHA-256 for the same semantic
object. NaN and infinity are rejected. Unknown fields are rejected by domain
parsers and schemas.

A launch specification loaded from a local file is parsed and then serialized
canonically before registration. Later attempts compare exact canonical bytes.

## Desired control document

Path:

```text
controls/<run_id>.json
```

Schema:

```text
schemas/control-v1.schema.json
```

Minimal example:

```json
{
  "action": "run",
  "generation": 1,
  "run_id": "202607241430-calm-otter",
  "schema_version": 1
}
```

Full field table:

| Field | Required | Rule |
|---|---:|---|
| `schema_version` | yes | Must equal `1` |
| `run_id` | yes | Must match the path and safe ID pattern |
| `generation` | yes | Integer at least 1; each publication advances exactly one |
| `action` | yes | `run`, `pause`, `stop`, or `abort` |
| `reason` | no | Non-empty string with at most 2,000 characters |
| `resume_from` | no | Valid artifact reference; allowed only with `run` |

Protocol v1 carries lifecycle only. It has no epoch cap, step limit, learning
rate, queue priority, or arbitrary parameter map. Such values belong in the
immutable worker and launch contract.

### Publication concurrency

`HubControlStore.publish()` first resolves current head and reads existing
control. It requires the actual generation to equal `expected_generation` and
the new generation to equal `expected_generation + 1`. It creates a commit with
the resolved head as `parent_commit`.

Concurrent writers cannot silently replace one another. One wins, and another
receives an error. The losing writer must re-read and reconsider.

### Snapshot identity

A fetched control becomes `ControlSnapshot` with:

- Control repository ID.
- Exact 40-character Git revision.
- Expected control path.
- Canonical file SHA-256.
- Time observed.
- Parsed `ControlDocument`.

Receipts copy these fields so an auditor can recover the exact requested bytes.

## Artifact reference

An artifact reference identifies one immutable Bucket object:

```json
{
  "bucket": "owner/jobs-artifacts",
  "bytes": 123456,
  "key": "202607241430-calm-otter/checkpoints/sha256-<64-hex>/checkpoint.hfjob",
  "sha256": "<64-lowercase-hex>"
}
```

Rules include:

- Bucket uses `namespace/name` form.
- Key is a relative POSIX path with at most 1,024 characters.
- Key contains a path component exactly equal to `sha256-<digest>`.
- Key contains no backslash, empty component, `.`, or `..`.
- `bytes` is positive.
- SHA-256 is lowercase hexadecimal.

The Bucket store computes the complete bundle digest and size before upload. If
the key already exists, it reads and verifies existing bytes. A mismatch at a
content-addressed key is fatal.

Downloads verify Bucket identity, byte count, and complete bundle digest before
restore.

## Launch specification

Path:

```text
launch-specs/<run_id>.json
```

Schema:

```text
schemas/launch-spec-v1.schema.json
```

Fields:

| Field | Required | Meaning |
|---|---:|---|
| `schema_version` | yes | Must equal `1` |
| `image` | yes | Container image reference |
| `command` | yes | Non-empty array of non-empty arguments |
| `flavor` | yes | Hugging Face hardware flavor |
| `timeout` | yes | Explicit platform timeout |
| `environment` | yes | String-valued non-secret variables |
| `secret_names` | yes | Unique names whose values are read at launch |
| `labels` | yes | String-valued custom labels |
| `namespace` | no | Hugging Face namespace for the physical Job |

`RUN_ID` and `ATTEMPT_ID` are forbidden in `environment`. The launcher injects
them. Secret values never appear in the specification.

The first launch attempts to register the spec before creating compute. If the
path exists, byte equality is required. Registration retries three times around
concurrent repository updates. A registered spec remains valid when the
subsequent Job API request fails.

Changing any field creates a launch mismatch. Common accidental mismatches
include a new timeout, an added diagnostic label, a different script URL,
reordered command arguments, a changed environment revision, or a new secret
name.

## Observed status

Path:

```text
<prefix>/<run_id>/status.json
```

Schema:

```text
schemas/run-status-v1.schema.json
```

The file is mutable and represents latest observed state. Its history remains
available through dataset commits.

Fields:

| Field | Required | Meaning |
|---|---:|---|
| `schema_version` | yes | Must equal `1` |
| `run_id` | yes | Logical run identity |
| `attempt_id` | yes | Attempt that wrote latest status |
| `job_id` | no | Hugging Face physical Job identity |
| `state` | yes | Current observed lifecycle state |
| `updated_at` | yes | Timezone-aware RFC 3339 timestamp |
| `last_applied_generation` | yes | Latest generation accepted by controller |
| `last_action` | yes | Action from that generation |
| `boundary` | no | Latest safe boundary |
| `checkpoint` | no | Latest content-addressed bundle reference |
| `metrics` | no | Latest JSON-compatible metrics |
| `message` | no | Status detail with at most 2,000 characters |

### States

| State | Meaning |
|---|---|
| `created` | Reserved observed state for a created logical run |
| `running` | Attempt started and remains eligible to continue |
| `pausing` | Worker accepted pause or entered safe pause handling |
| `paused` | Attempt ended successfully with resume checkpoint |
| `stopping` | Worker accepted stop and is finalizing |
| `completed` | Logical run ended successfully |
| `aborting` | Worker accepted abort or rejected unsupported pause |
| `aborted` | Logical run ended unsuccessfully by abort |
| `failed` | Worker ended because a required guarantee failed |

The current controller publishes `running` at start and each boundary. It
publishes a transition state for a new exit action, then `finish()` publishes
the terminal state.

## Boundary document

A boundary appears in status, checkpoint manifest, and receipts:

```json
{
  "metadata": {
    "epoch": 2,
    "global_step": 14018
  },
  "name": "half-epoch",
  "reached_at": "2026-07-24T08:30:00Z",
  "sequence": 4
}
```

Rules:

- Name is non-empty and at most 100 characters.
- Sequence is a nonnegative integer.
- Time includes a timezone and is normalized to UTC.
- Metadata is a JSON object.

The library does not enforce monotonic sequence. The integration should.

## Applied-control receipt

Path:

```text
<prefix>/<run_id>/attempts/<attempt_id>/receipts/generation-<generation:08d>.json
```

Schema:

```text
schemas/applied-control-v1.schema.json
```

Required evidence includes:

- Logical and physical attempt IDs.
- Control repository, exact revision, path, and file SHA-256.
- Generation and action.
- Observation and application timestamps.
- Outcome.

Optional evidence includes physical `job_id`, boundary, checkpoint, and adapter
restore evidence.

Typical outcomes are:

| Outcome | Context |
|---|---|
| `started` | Fresh generation applied at worker startup |
| `resumed` | Startup restored a referenced checkpoint |
| `accepted` | New boundary action accepted |
| `rejected-unsupported` | Adapter could not honor pause |

Receipts are immutable. Publishing the same bytes to the same path is
idempotent. Different bytes at an existing receipt path raise an error.

The receipt is written before internal generation state advances and before
transition status is published. This ordering makes action application
auditable after a process interruption.

No receipt is written when control cannot be fetched or parsed at a boundary.
The worker has no valid snapshot to attest. Status records the safe-pause
message instead.

## Checkpoint bundle

A `.hfjob` checkpoint is a ZIP archive with exactly two entries:

```text
manifest.json
payload.bin
```

Additional or missing entries are rejected. ZIP compression is `ZIP_STORED`.

### Inner manifest

Schema:

```text
schemas/checkpoint-manifest-v1.schema.json
```

Example shape:

```json
{
  "adapter": {
    "name": "training-state",
    "resume_mode": "exact",
    "version": 1
  },
  "attempt_id": "attempt-123",
  "boundary": {
    "metadata": {},
    "name": "optimizer-step",
    "reached_at": "2026-07-24T08:30:00Z",
    "sequence": 7009
  },
  "created_at": "2026-07-24T08:30:05Z",
  "metadata": {
    "format": "training-checkpoint-v1"
  },
  "payload_bytes": 987654321,
  "payload_sha256": "<64-lowercase-hex>",
  "run_id": "202607241430-calm-otter",
  "schema_version": 1
}
```

The manifest binds payload bytes to run, attempt, boundary, and adapter. Restore
requires exact adapter specification equality, including resume mode and
version.

### Verification layers

Checkpoint restore has two digest layers:

1. `ArtifactRef.sha256` covers the complete ZIP bundle.
2. `CheckpointManifest.payload_sha256` covers extracted `payload.bin`.

Both include exact byte counts. The outer layer protects artifact transport and
reference identity. The inner layer protects payload identity after archive
parsing.

## Resume modes

The adapter manifest records one mode:

| Mode | Checkpoint supplied on CLI resume | Worker restore called | Pause accepted |
|---|---:|---:|---:|
| `exact` | yes | yes | yes |
| `boundary` | yes | yes | yes |
| `restart` | no | no | yes |
| `unsupported` | no | no | no |

For `restart`, the paused checkpoint remains useful as evidence. The CLI
verifies it before publishing `run` without `resume_from`.

## Generation semantics

Generation begins at 1 and advances by exactly one per published control
update. A worker can observe four cases at a boundary.

### Newer generation

The worker evaluates the new action, writes a receipt, updates its in-memory
generation, publishes transition status, and returns a decision.

A gap is accepted because a worker may miss intermediate desired states while
it is processing one long unit. The receipt identifies the latest generation it
actually observed.

### Same generation and same action

This is a normal repeated read. No new receipt is written. The current action
produces the corresponding decision. Under `run`, work continues.

### Same generation with different action

This indicates mutation without generation advancement. The worker publishes a
safe-pause message and returns a pause decision without accepting the malformed
change.

### Older generation

This indicates rollback or inconsistent storage. The worker publishes a
safe-pause message and returns a pause decision.

At startup, the current desired generation must be strictly newer than latest
observed status. This blocks duplicate attempts from replaying an already
applied `run` generation.

## Boundary ordering

The actual v0.1 controller order is:

1. Publish optional metrics.
2. Save adapter payload.
3. Create checkpoint bundle.
4. Upload complete bundle to the artifact store.
5. Publish observed `running` status with the checkpoint.
6. Fetch current control with bounded retries.
7. Handle generation and action.
8. Publish receipt for a newly applied generation.
9. Publish transition status.
10. Return decision.
11. Let the application finalize outputs.
12. Publish terminal status through `finish()`.

An auditor should expect a checkpoint and running-status commit before the
receipt for a boundary action.

## Metrics

Metrics must be a JSON object with finite JSON values. Generic status stores the
latest boundary metrics. Historical metric series belong in the project data
repository or an optional sink.

`WandbMetricSink` writes metrics at `boundary.sequence` and adds
`control/boundary`. Sink errors are caught and reported in status. They do not
change control, checkpoint, or receipt behavior.

## Store retries

Control fetch uses `ControllerConfig.control_attempts`, default 3, and
`retry_delay_seconds`, default 2 seconds. Status and receipt commits and launch
spec registration each perform their own bounded optimistic retry where
implemented.

Dataset commits use a resolved parent head. Concurrent unrelated commits may
cause a retry. Immutable paths are checked for equal existing bytes.

## Security model

The protocol proves integrity relative to recorded digests and repository
history. Access control still matters.

- A writer to the control dataset can request lifecycle changes.
- A writer to the status dataset can publish observed evidence.
- A writer to the artifact Bucket can publish bytes under new keys.
- A token able to launch Jobs can spend compute.
- A checkpoint payload may use framework serialization capable of code
  execution when loaded.

Use private resources, least-privilege tokens, pinned code, immutable launch
specs, and trusted checkpoint publishers. Never interpret hashing as proof that
an artifact came from an authorized producer without checking repository and
Bucket access.

## Schema and model differences

JSON Schemas describe wire shape. Python models add semantic validation such as
safe path components, timezone awareness, adapter equality, exact run-path
matching, and content-address key requirements.

Validate external documents with the package models before use. Do not rely on
a schema check alone when constructing control or restore behavior.

## Versioning

Protocol documents carry `schema_version: 1`. Adapter payload formats have a
separate `AdapterSpec.version`. Package versions and launch specifications have
separate identities too.

A schema change, adapter change, and package release are different events. Keep
each version explicit. The package rejects unsupported schema versions rather
than guessing compatibility.
