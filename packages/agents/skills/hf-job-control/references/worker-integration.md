---
date: 2026-07-24
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
title: HF Job Control worker integration
tags: [hugging-face, jobs, python, checkpoints, resume]
---

# Worker integration

A controlled worker defines the boundary where it can stop safely and the
checkpoint payload that can restore that boundary. `hf-job-control` supplies
storage and validation, lifecycle decisions and status, plus receipts.

## Integration contract

The application owns:

- The definition of a safe boundary.
- Construction of model, optimizer, scheduler, data readers, and other mutable
  state.
- Checkpoint serialization and restoration.
- The claimed resume mode and evidence supporting it.
- Scientific metrics and stopping policy.
- Final model or dataset publication.
- Cleanup and framework-specific process exit.

The package owns:

- Logical and physical attempt identity validation.
- Desired-state reads from exact control revisions.
- Monotonic generation handling.
- Checkpoint bundle construction and hashing.
- Content-addressed artifact upload and verification.
- Mutable observed status.
- Immutable applied-control receipts.
- Immutable launch-spec registration.
- Typed lifecycle decisions.

The package does not terminate the process. The worker must honor
`Decision.should_exit` and `Decision.exit_code`.

## Required worker environment

`hf-job-control launch` injects:

```text
RUN_ID=<logical run ID>
ATTEMPT_ID=<physical attempt ID>
```

Hugging Face injects:

```text
JOB_ID=<server-assigned physical Job ID>
```

Project configuration must also identify the stores. These may come from normal
environment values because repository and Bucket names are not secrets:

```text
HF_JOB_CONTROL_REPO=owner/jobs-control
HF_JOB_STATUS_REPO=owner/project-status
HF_JOB_ARTIFACT_BUCKET=owner/job-artifacts
HF_JOB_STATUS_PREFIX=runs
```

The current library's `ControllerConfig.from_environment()` reads `RUN_ID`,
`ATTEMPT_ID`, and optional `JOB_ID`. Construct the stores explicitly from the
other values.

## Minimal integration

```python
from __future__ import annotations

import os
from pathlib import Path

from hf_job_control import (
    AdapterSpec,
    Boundary,
    CheckpointManifest,
    Controller,
    ControllerConfig,
    HubBucketArtifactStore,
    HubControlStore,
    HubStatusStore,
    ResumeMode,
)
from hf_job_control.models import JsonObject


class ApplicationAdapter:
    @property
    def spec(self) -> AdapterSpec:
        return AdapterSpec(
            name="application-state",
            version=1,
            resume_mode=ResumeMode.EXACT,
        )

    def save(self, destination: Path, boundary: Boundary) -> JsonObject:
        save_application_state(destination)
        return {
            "global_position": boundary.sequence,
            "format": "application-checkpoint-v1",
        }

    def restore(
        self,
        source: Path,
        manifest: CheckpointManifest,
    ) -> JsonObject:
        restored = restore_application_state(source)
        if restored.global_position != manifest.boundary.sequence:
            raise ValueError("restored position does not match checkpoint boundary")
        return {
            "global_position": restored.global_position,
            "state_sha256": restored.state_sha256,
        }


def make_controller() -> Controller:
    return Controller(
        ControllerConfig.from_environment(),
        control_store=HubControlStore(os.environ["HF_JOB_CONTROL_REPO"]),
        status_store=HubStatusStore(
            os.environ["HF_JOB_STATUS_REPO"],
            prefix=os.environ.get("HF_JOB_STATUS_PREFIX", "runs"),
        ),
        artifact_store=HubBucketArtifactStore(
            os.environ["HF_JOB_ARTIFACT_BUCKET"]
        ),
    )


def run() -> int:
    construct_application_state()
    adapter = ApplicationAdapter()
    controller = make_controller()
    start = controller.start(adapter)
    validate_start_result(start)

    while work_remains():
        perform_next_committable_unit()
        if not reached_safe_boundary():
            continue

        boundary = Boundary(
            name="committed-unit",
            sequence=current_global_position(),
            metadata={"partition": current_partition()},
        )
        decision = controller.boundary(
            boundary=boundary,
            adapter=adapter,
            metrics=collect_registered_metrics(),
        )
        if decision.should_exit:
            finalize_application_outputs(decision)
            controller.finish(
                decision,
                message=f"ended at {boundary.name} {boundary.sequence}",
            )
            return decision.exit_code

    raise RuntimeError(
        "work ended without a terminal control action; publish stop at the final boundary"
    )


if __name__ == "__main__":
    raise SystemExit(run())
```

`JsonObject` is defined in `hf_job_control.models` in v0.1 and is not exported
from the package root. Keep imports aligned with the installed package.

## Startup sequence

Construct the immutable architecture and mutable objects required by the
adapter before calling `start()`. The adapter restore method needs a valid
model and optimizer plus scheduler and data-order objects to receive state.

A fresh start follows this sequence:

1. Read current project status, if one exists.
2. Fetch desired control from one exact dataset head.
3. Require a generation newer than the last observed status generation.
4. Require desired action `run`.
5. Publish a `started` receipt.
6. Publish observed status `running`.

A resume adds these steps before the receipt:

1. Download the `resume_from` bundle.
2. Verify outer Bucket identity, byte count, and SHA-256.
3. Require exactly `manifest.json` and `payload.bin` in the ZIP.
4. Validate manifest schema, logical run ID, and adapter specification.
5. Hash the extracted payload and compare it with the inner manifest.
6. Call `adapter.restore()`.
7. Put returned restore evidence in the `resumed` receipt.

Do not start data iteration before `start()` completes. A shuffle iterator
created before RNG and sampler restoration can consume state and break exact
resume.

## Startup generation rule

A new physical attempt must observe a desired generation newer than the latest
observed status. This rejects replayed startup generations and prevents stale
`run` state from starting duplicate attempts.

Normal exact resume satisfies the rule because `hf-job-control resume`
publishes a new `run` generation. A failed physical launch that never published
startup status can be retried with the same desired generation and identical
launch specification. If startup status already exists, do not launch another
attempt under the same generation.

The v0.1 CLI has no general restart command for a non-paused failed status. An
integration that needs infrastructure recovery from such a state must define and
test a project policy before production use. Do not hand-edit status or control
to bypass the startup rule.

## Safe boundary design

A safe boundary is a point where the serialized payload and committed external
outputs describe one consistent position. Examples include:

- The end of an optimizer step after gradient accumulation is complete.
- The end of an evaluation interval after metrics and predictions are durable.
- A fully written generation chunk with an atomic durable manifest.
- A committed data partition with its output checksum.
- A completed transactional import batch.

Avoid boundaries in the middle of a gradient accumulation window, file write,
multi-part upload, database transaction, distributed collective, or mutable
sampler transition.

Use a stable boundary name and a globally meaningful sequence. The library
requires a nonnegative sequence but does not enforce monotonicity. The
integration should enforce it and reject checkpoint rollback.

Keep boundary metadata small and JSON-safe. Useful metadata includes epoch,
global step, shard ID, row offset, partition, source revision, or output digest.
Do not include secrets, large arrays, NaN, infinity, or mutable URLs.

### Output-producing boundaries

A cursor alone is not recoverable progress for generation, inference, or ETL.
Before calling `boundary()`, upload the completed output unit and publish an
immutable manifest that records its input range, record count, input digest,
output key, byte count, output SHA-256, and producer contract digest. The
producer contract must bind code and model revisions to decoding, precision,
batch size, normalization, and serialization.

The adapter payload should contain the ordered unit manifests or the digest of a
durable manifest index. On restore, verify all referenced outputs, reconstruct
the completed input set, and begin with the next missing unit. Reject gaps,
overlaps, duplicate units, mixed producer contracts, and checksum failures.

Commit output bytes first, then the unit manifest, and then the controller
checkpoint. Only after those writes succeed may observed status describe the
unit as recoverable. Logging a row count or uploading a status file without the
output bytes does not create a safe boundary.

Choose units small enough to satisfy the loss window in
`paid-compute-launch`. Prove pause and boundary resume on the real worker before
a large fleet launch.

## Boundary call behavior

`Controller.boundary()` performs the following operations:

1. It sends metrics to the configured `MetricSink`.
2. It isolates metric-sink exceptions and carries the error into status.
3. It invokes `adapter.save()` into a temporary payload path.
4. It hashes the payload and writes the two-entry checkpoint bundle.
5. It hashes and uploads the complete bundle under a content-addressed key.
6. It publishes `running` status containing boundary and checkpoint plus metrics.
7. It fetches control with bounded retries.
8. It evaluates generation and action.
9. For a new generation, it writes an immutable receipt before transition
   status.
10. It returns a `Decision`.

A repeated generation with the same action returns the same continue or exit
semantics without writing another receipt. A generation that moves backwards or
an action that changes without a generation causes a safe pause decision.

If control remains unavailable after retries, the controller returns a pause
decision using the latest checkpoint and publishes `pausing`. No new control
receipt exists because no valid control snapshot was applied. The worker must
finalize and call `finish()` so status becomes `paused`.

## Decision handling

Handle every decision immediately:

```python
decision = controller.boundary(
    boundary=boundary,
    adapter=adapter,
    metrics=metrics,
)
if decision.should_exit:
    finalize_outputs()
    controller.finish(decision)
    raise SystemExit(decision.exit_code)
```

Do not begin another unit after `should_exit` becomes true. Do not call
`finish()` for a continue decision. The method rejects that misuse.

Expected decisions are:

| Action | `should_exit` | Target | Exit code |
|---|---:|---|---:|
| `run` | false | `running` | 0 |
| `pause` | true | `paused` | 0 |
| `stop` | true | `completed` | 0 |
| `abort` | true | `aborted` | 1 |
| Unsupported pause | true | `failed` | 1 |

For unsupported pause, transition status is first published as `aborting` with
a message. `finish()` publishes `failed`.

## Natural completion limitation

The v0.1 controller can publish a terminal status through `finish()` only after
an exit decision. A bounded worker that reaches its natural endpoint while
desired action remains `run` cannot call `finish()` with the continue decision.

Choose one tested integration policy:

- Arrange for the operator or automation to publish `stop` before the final safe
  boundary.
- Keep project-specific final status separate and document that the generic
  controller status remains `running` in v0.1.
- Extend the package in a reviewed release with an explicit natural-completion
  API before relying on bounded automatic completion.

Do not construct a fake `Decision` in application code and do not mutate the
status dataset by hand.

## CheckpointAdapter contract

An adapter exposes one stable specification:

```python
AdapterSpec(
    name="training-state",
    version=1,
    resume_mode=ResumeMode.EXACT,
)
```

The name must match `^[a-z][a-z0-9_-]{0,63}$`. Increase `version` whenever the
payload format or restoration semantics become incompatible. A resumed worker
must present exactly the same `AdapterSpec` as the checkpoint manifest.

`save(destination, boundary)` must:

- Write one complete payload file at `destination`.
- Flush and close all nested writers before returning.
- Capture state corresponding exactly to `boundary`.
- Return small JSON metadata that describes format and state.
- Raise on partial state, failed synchronization, or serialization error.
- Avoid external mutable references needed for restore.

`restore(source, manifest)` must:

- Treat `source` as a verified but application-specific payload.
- Validate its own internal format and invariants.
- Restore every state item promised by the resume mode.
- Check that restored position matches `manifest.boundary`.
- Return small JSON evidence that proves what was restored.
- Raise before work begins when any required state is missing or incompatible.

The package stores payloads with ZIP method `ZIP_STORED`, so the adapter should
perform compression internally only when it is worthwhile. For multi-file
framework checkpoints, write a deterministic tar archive, SQLite file, or
framework bundle into the single destination path.

## Resume mode selection

### Exact

Choose `exact` only when continuation after restore produces the same future
execution as an uninterrupted run from the boundary. Exactness covers state,
data order, and subsequent computations. Similar metrics are insufficient.

### Boundary

Choose `boundary` when all work through the boundary is committed and resume
can begin with the next unit, while process-local details may differ. Sharded
generation and partitioned ETL are common cases.

The adapter should verify output manifests and reject a boundary whose committed
files are absent or have wrong checksums.

### Restart

Choose `restart` when immutable inputs make repetition safe and cheaper than
restoration. The pause checkpoint can carry diagnostics, but the CLI publishes
the next `run` generation without `resume_from`.

The worker still needs deterministic input identity and idempotent output
handling. Restart does not authorize duplicate publication or silent overwrite.

### Unsupported

Choose `unsupported` when pause cannot preserve a usable state. Stop and abort
can still end the worker at a boundary. A pause request is rejected and exits
failed, which exposes the unsupported guarantee instead of pretending that
resume is possible.

## Exact PyTorch state

An exact PyTorch checkpoint usually contains all of the following:

- Model state dict, including buffers and tied-weight behavior.
- Optimizer state dict and parameter-group configuration.
- Scheduler state dict.
- Automatic mixed-precision scaler state when a scaler is active.
- Python `random` state.
- NumPy RNG state when NumPy participates in data or augmentation.
- Torch CPU RNG state.
- Every CUDA RNG state returned by `torch.cuda.get_rng_state_all()`.
- DataLoader generator state.
- Sampler epoch and permutation plus cursor and distributed rank state.
- Current epoch and global optimizer step plus microstep and
  accumulated-gradient position.
- Gradient tensors when the boundary permits partially accumulated gradients.
- Early-stopping and patience state plus best score and best checkpoint.
- Dynamic loss, curriculum, mixture, or sampling state.
- Framework callback and plugin state that affects future computation.
- Input dataset revision, membership digest, order seed, code digest, and model
  initialization revision for compatibility checks.

Place trainable parameters and optimizer state on the intended device and dtype
after restore. Verify that optimizer state tensors correspond to the restored
parameters. Constructing a new optimizer after loading scheduler state can
silently change learning rate behavior.

For distributed training, capture and restore rank-specific RNG and sampler
state. Coordinate checkpoint creation so every rank describes the same global
boundary. The v0.1 package has no built-in distributed checkpoint coordinator,
so the application must create one aggregate payload before calling the
controller.

## PyTorch payload outline

The following outline shows state categories. Adapt it to the framework and test
it against uninterrupted execution.

```python
import random
from pathlib import Path

import numpy as np
import torch


def save_training_state(destination: Path) -> None:
    payload = {
        "format_version": 1,
        "model": model.state_dict(),
        "optimizer": optimizer.state_dict(),
        "scheduler": scheduler.state_dict(),
        "scaler": None if scaler is None else scaler.state_dict(),
        "python_rng": random.getstate(),
        "numpy_rng": np.random.get_state(),
        "torch_rng": torch.get_rng_state(),
        "cuda_rng": torch.cuda.get_rng_state_all(),
        "loader_generator": loader_generator.get_state(),
        "sampler": sampler.state_dict(),
        "progress": progress.to_dict(),
        "selection": selection_state.to_dict(),
        "compatibility": immutable_input_manifest(),
    }
    torch.save(payload, destination)


def restore_training_state(source: Path) -> dict[str, object]:
    # torch.load uses pickle for general objects. Load only a bundle already
    # verified from the trusted artifact Bucket for this run.
    payload = torch.load(source, map_location="cpu", weights_only=False)
    validate_payload_shape(payload)
    verify_immutable_inputs(payload["compatibility"])

    model.load_state_dict(payload["model"], strict=True)
    optimizer.load_state_dict(payload["optimizer"])
    scheduler.load_state_dict(payload["scheduler"])
    if scaler is not None:
        scaler.load_state_dict(payload["scaler"])

    random.setstate(payload["python_rng"])
    np.random.set_state(payload["numpy_rng"])
    torch.set_rng_state(payload["torch_rng"])
    torch.cuda.set_rng_state_all(payload["cuda_rng"])
    loader_generator.set_state(payload["loader_generator"])
    sampler.load_state_dict(payload["sampler"])
    progress.load_dict(payload["progress"])
    selection_state.load_dict(payload["selection"])

    return {
        "global_step": progress.global_step,
        "epoch": progress.epoch,
        "data_position": sampler.position,
    }
```

Never load an untrusted pickle payload. Outer and inner hashing prove integrity
against the recorded reference, while repository and Bucket permissions define
who could publish that reference.

## Data pipeline exactness

Default DataLoader shuffling is often insufficient for exact resume because
reconstructing an iterator can consume RNG differently. Use a stateful sampler
or persist the full permutation and cursor. Test with multiple workers if
production uses them.

Capture:

- Dataset membership and ordering digest.
- Shuffle seed and current generator state.
- Epoch number and in-epoch cursor.
- Worker-seeding inputs.
- Distributed sampler epoch and rank.
- Batch drop policy.
- Dynamic bucketing or length-sorting queues.
- Mixture-source cursors and weights.

Resume should produce the same next batch IDs before any optimizer comparison is
considered valid.

## External outputs

A checkpoint can refer to already committed outputs only when those outputs are
immutable and verified. For boundary resume, store output paths and checksums in
manifest metadata or payload. On restore, verify them before advancing the
cursor.

Avoid a sequence where output publication succeeds but the checkpoint records
the previous cursor. Either make output publication idempotent or write an
atomic manifest that defines the committed boundary.

## Metrics

Pass only JSON-compatible finite metrics:

```python
metrics = {
    "loss": float(loss),
    "exact_match": int(exact_matches),
    "rows": int(rows),
    "learning_rate": float(optimizer.param_groups[0]["lr"]),
}
```

`WandbMetricSink` adds `control/boundary` and logs with
`boundary.sequence` as the step. A W&B exception is captured in status and does
not block checkpoint or control. W&B remains a monitoring surface.

Do not make lifecycle correctness depend on a metric sink. Publish durable
project metrics before or alongside the safe boundary when scientific audit
requires more detail than generic status can hold.

## Control failure handling

`ControllerConfig` defaults to three control fetch attempts with a two-second
delay. Customize these values from immutable worker configuration when network
conditions require it:

```python
ControllerConfig(
    run_id=os.environ["RUN_ID"],
    attempt_id=os.environ["ATTEMPT_ID"],
    job_id=os.environ.get("JOB_ID"),
    control_attempts=5,
    retry_delay_seconds=5.0,
)
```

At startup, exhausted retries raise `ControlError` because there is no active
controlled attempt to pause safely. At a boundary, exhausted retries return a
pause decision after checkpoint and status publication.

Catch top-level exceptions to publish project-specific failure evidence when
possible. Do not swallow controller exceptions and continue training.

## Security

- Pin package and worker code to immutable revisions.
- Limit the worker token to required private resources.
- Keep secret values out of launch JSON and checkpoint metadata.
- Treat checkpoint payloads as sensitive when optimizer state or data examples
  can reveal training information.
- Validate internal payload structure before loading framework state.
- Never restore from a control document belonging to another run.
- Do not bypass adapter identity checks.
- Avoid shell interpolation of untrusted run IDs or metadata.
- Keep serialized paths relative and reject traversal.

## Local test matrix

Every integration should test:

1. CPU construction without remote compute.
2. One finite unit of work.
3. Checkpoint save and restore round trip.
4. Exact or boundary continuation against a reference.
5. Repeated `run` generation.
6. Pause and stop decisions, including the separate abort exit behavior.
7. Unsupported pause when that mode is used.
8. Control outage after checkpoint publication.
9. Metric-sink failure.
10. Wrong run ID, adapter version, payload digest, and byte count.
11. Replay of an already observed startup generation.
12. Launch-spec mismatch on a later attempt.
13. Status and receipt inclusion of physical `JOB_ID`.
14. Finalization and process exit codes.

For exact training, compare state after at least one additional optimizer step
following restore. A checkpoint that merely reloads without error does not prove
exact continuation.

## Remote adoption gates

Before expensive production work:

1. Run the generic remote CPU canary through pause and resume, followed by stop
   and abort.
2. Run the application worker on CPU through construction and one finite unit.
3. Run application-specific small fits or shards on the target hardware.
4. Prove checkpoint upload size and elapsed time fit the boundary budget.
5. Pause and resume the application worker remotely.
6. Compare post-resume state with an uninterrupted remote reference when exact
   resume is claimed.
7. Verify every receipt and content-addressed object.
8. Register and inspect the immutable production launch specification.

Repeat these gates after changing worker code, adapter version, framework,
model initialization, data order, checkpoint format, or package revision.
