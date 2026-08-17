---
date: 2026-07-24
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
title: HF Job Control verification checklists
tags: [hugging-face, verification, jobs, release]
---

# Verification checklists

Use these checklists as evidence gates. Mark an item complete only after checking
its named surface. A successful command exit does not satisfy later evidence
items automatically.

## New deployment

### Account and tools

- [ ] `hf auth whoami` identifies the intended owner or organization.
- [ ] The installed `hf` CLI exposes `jobs`, `datasets`, and `buckets` commands.
- [ ] `hf-job-control --help` matches the package revision intended for workers.
- [ ] Python is 3.11 or newer.
- [ ] Node.js 22 or newer and `npx` are available when automatic petnames are
      required.
- [ ] Token values remain absent from shell tracing, logs, launch JSON, and
      captured command output.

### Stores

- [ ] The control dataset exists under the intended namespace.
- [ ] The status dataset exists under the intended namespace.
- [ ] The artifact Bucket exists under the intended namespace.
- [ ] Privacy settings match project policy.
- [ ] The operator can read and write control.
- [ ] The worker can read control and write status plus receipts and artifacts.
- [ ] The status prefix is chosen and documented.
- [ ] Existing documents will not collide with the new run.

### Protocol

- [ ] Control schema version is 1.
- [ ] Schemas are available for status and receipts plus launch specifications
      and checkpoints.
- [ ] Desired state and observed state use separate repositories or clearly
      separated project boundaries.
- [ ] Artifact keys are treated as immutable and content-addressed.
- [ ] The project records exact Hub revisions and digests alongside submitted
      code.

## Worker integration review

### Scope

- [ ] The application owns scientific stopping and final artifact selection.
- [ ] The package owns lifecycle mechanics only.
- [ ] A safe boundary is named and explained.
- [ ] Maximum expected time between boundaries is measured.
- [ ] Boundary sequence remains meaningful across attempts.
- [ ] External outputs are committed consistently with the checkpoint cursor.

### Controller use

- [ ] `ControllerConfig.from_environment()` receives `RUN_ID` and `ATTEMPT_ID`.
- [ ] Physical `JOB_ID` is present on Hugging Face Jobs.
- [ ] Store IDs and status prefix are immutable for the attempt series.
- [ ] `Controller.start(adapter)` runs before new work or data iteration.
- [ ] `Controller.boundary()` runs only after state is safe to serialize.
- [ ] Every exit decision triggers application finalization.
- [ ] `Controller.finish(decision)` runs after finalization.
- [ ] The process exits with `decision.exit_code`.
- [ ] Continue decisions do not call `finish()`.
- [ ] Exceptions from controller operations do not get swallowed while work
      continues.

### Adapter

- [ ] Adapter name follows the required lowercase identifier pattern.
- [ ] Adapter version matches the payload format.
- [ ] Resume mode is the strongest mode actually proven.
- [ ] `save()` writes one complete payload file.
- [ ] Returned metadata is small and finite, uses JSON-safe values, and contains
      no secrets.
- [ ] `restore()` validates internal payload structure.
- [ ] Restored position matches manifest boundary.
- [ ] Restore evidence identifies the restored position and state.
- [ ] Immutable input revisions are stored and verified.
- [ ] Incompatible adapter versions fail before new work.

### Exact PyTorch resume

- [ ] Model parameters and buffers are captured.
- [ ] Optimizer state and parameter groups are captured.
- [ ] Scheduler state is captured.
- [ ] Mixed-precision scaler state is captured when used.
- [ ] Python, NumPy, Torch CPU, and every CUDA RNG state are captured as
      applicable.
- [ ] DataLoader generator state is captured.
- [ ] Sampler permutation and epoch plus cursor and distributed state are
      captured.
- [ ] Global step and epoch plus microstep and accumulation position are
      captured.
- [ ] Partially accumulated gradients are absent at the boundary or captured.
- [ ] Best-score and patience state plus model-selection state are captured.
- [ ] Dynamic mixture, curriculum, or sampling state is captured.
- [ ] Framework callbacks or plugins that affect future work are captured.
- [ ] Restore occurs before iterator creation or RNG consumption.
- [ ] The next batch IDs match uninterrupted execution.
- [ ] Subsequent losses and state match uninterrupted execution.

### Failure behavior

- [ ] Metric-sink failure leaves control and checkpointing operational.
- [ ] Control outage at a boundary produces a safe pause decision.
- [ ] Malformed or stale control does not let work continue.
- [ ] Artifact digest and byte-count mismatches fail restore.
- [ ] Wrong run ID and adapter identity fail restore.
- [ ] Unsupported pause ends failed with a rejection receipt.
- [ ] Startup replay of an observed generation fails.
- [ ] A receipt publication failure prevents lifecycle action.
- [ ] Worker top-level failure evidence is project-visible.

## Local acceptance

- [ ] Package unit tests pass.
- [ ] Checkpoint bundle round trip passes.
- [ ] Deterministic pause/resume comparison passes.
- [ ] Repeated generation behavior passes.
- [ ] Generation conflict behavior passes.
- [ ] Stop and abort exit codes pass.
- [ ] Status and receipts contain physical Job ID when set.
- [ ] Launch-spec mismatch test passes.
- [ ] Ruff formatting and lint pass.
- [ ] Strict mypy passes.
- [ ] Coverage gate passes.
- [ ] Dependency audit passes.
- [ ] Slophammer dry and check pass.
- [ ] Mutation threshold passes.
- [ ] Documentation check passes.
- [ ] Built wheel and sdist pass metadata checks.

## Remote canary

### First attempt

- [ ] New petname logical run ID is recorded.
- [ ] Generation 1 desired action is `run`.
- [ ] Canary package ref is immutable.
- [ ] Launch uses `cpu-basic` and explicit timeout.
- [ ] Launch result contains the logical run ID plus physical attempt and Job
      IDs.
- [ ] Physical labels and environment contain matching identities.
- [ ] Launch specification is registered and has a recorded digest.
- [ ] Startup status is `running` at generation 1.
- [ ] Generation 1 receipt outcome is `started`.

### Pause

- [ ] Pause uses expected generation 1.
- [ ] Desired generation 2 action is `pause`.
- [ ] Worker reaches a later counter boundary.
- [ ] Checkpoint reference is present before terminal status.
- [ ] Generation 2 receipt records action and boundary plus checkpoint and Job
      ID.
- [ ] Final observed state is `paused`.
- [ ] Physical Job exits successfully.
- [ ] `verify` passes outer bundle and inner manifest checks.

### Resume

- [ ] Resume requires observed `paused` state.
- [ ] Resume verifies checkpoint before publication.
- [ ] Generation 3 desired action is `run`.
- [ ] `resume_from` matches paused checkpoint for exact canary mode.
- [ ] Second launch reuses identical launch specification.
- [ ] Second attempt and Job IDs differ from the first.
- [ ] Generation 3 receipt outcome is `resumed`.
- [ ] Receipt evidence contains restored counter value and sequence.
- [ ] Counter continues from the paused value.

### Stop

- [ ] Stop uses expected generation 3.
- [ ] Generation 4 desired action is `stop`.
- [ ] Generation 4 receipt records final boundary and checkpoint.
- [ ] Observed state becomes `completed`.
- [ ] Physical Job exits successfully.
- [ ] All four receipt generations are present across both attempts.

### Abort canary

- [ ] Abort uses a separate logical run.
- [ ] Desired abort generation is recorded.
- [ ] Abort receipt exists with physical Job ID.
- [ ] Observed state becomes `aborted`.
- [ ] Physical Job ends nonzero as expected.
- [ ] Diagnostic checkpoint verifies when present.

## Production prelaunch

### Scientific and application policy

- [ ] The registered plan names the workload and immutable inputs.
- [ ] The plan defines bounded or open-ended horizon.
- [ ] Operator-selected stop is authorized when applicable.
- [ ] Model selection remains objective and separate from observation stopping.
- [ ] Metrics use training-only or otherwise authorized data.
- [ ] Private tests remain sealed until their release gate.
- [ ] Safe boundary and checkpoint frequency are fixed.
- [ ] Natural completion behavior is compatible with the v0.1 controller.

### Code and inputs

- [ ] Worker script is published at an immutable revision.
- [ ] Worker script SHA-256 is recorded.
- [ ] Package revision and built artifact digest are recorded.
- [ ] Model revision is immutable.
- [ ] Dataset revision and membership digest are immutable.
- [ ] Data order and seed are fixed.
- [ ] Adapter name and version are recorded together with resume mode.
- [ ] Construction and representation audits pass.
- [ ] Small finite-work and fit gates pass.
- [ ] Application-specific remote pause/resume gate passes.

### Launch specification

- [ ] JSON parses through `LaunchSpec.from_dict`.
- [ ] Schema version is 1.
- [ ] Image is pinned as tightly as project policy requires.
- [ ] Command points to immutable code.
- [ ] Flavor matches safety gates.
- [ ] Timeout is explicit and long enough for an operational attempt.
- [ ] Timeout is documented as separate from scientific horizon.
- [ ] Environment values are immutable and secret-free.
- [ ] `RUN_ID` and `ATTEMPT_ID` are absent from `environment`.
- [ ] Secret names are complete and secret values are absent.
- [ ] Labels identify project and phase without changing run identity.
- [ ] Namespace is correct.
- [ ] Canonical registered digest is recorded after launch.

### Capacity and isolation

- [ ] Current active Jobs are listed.
- [ ] Project concurrency limit is respected.
- [ ] No unrelated Job will be changed.
- [ ] Checkpoint payload and temporary disk peaks are measured.
- [ ] Bucket capacity and permissions are verified.
- [ ] Boundary upload duration fits operational timing.
- [ ] Control and status repositories accept test commits.

## Launch verification

- [ ] `create` output is saved.
- [ ] Logical run ID is copied exactly into project status.
- [ ] Initial control revision and SHA-256 are recorded.
- [ ] No physical Job already uses the run ID.
- [ ] `launch` output is saved.
- [ ] Attempt ID and Job ID are recorded.
- [ ] Physical Job inspection matches image and command, flavor and timeout,
      labels and environment, plus namespace.
- [ ] Registered launch-spec JSON matches intended semantic values.
- [ ] Registered launch-spec exact revision and SHA-256 are recorded.
- [ ] Startup receipt matches generation 1 and physical identities.
- [ ] Observed status becomes `running`.
- [ ] Workload construction status passes.
- [ ] Logs and resource statistics show healthy progress.
- [ ] Project status links logical and physical identities.

## Pause approval

Before request:

- [ ] The pause reason is operationally valid.
- [ ] Current desired generation and status are saved.
- [ ] The active physical Job is identified exactly.
- [ ] The worker is expected to reach another safe boundary.
- [ ] Adapter supports pause.
- [ ] No concurrent operator is changing the run.

After request:

- [ ] New generation is exactly previous plus one.
- [ ] Exact control revision and SHA-256 are recorded.
- [ ] Worker status advances to `pausing` and then `paused`.
- [ ] Receipt generation and action match request.
- [ ] Receipt boundary is at or after prior boundary.
- [ ] Receipt checkpoint matches final status checkpoint.
- [ ] Physical Job ID matches active attempt.
- [ ] Physical Job exits successfully.
- [ ] Checkpoint verification passes.
- [ ] Project-specific outputs through the boundary are durable.

## Resume approval

Before request:

- [ ] Observed state is exactly `paused`.
- [ ] Desired action is `pause` at the same applied generation.
- [ ] Latest status has a checkpoint.
- [ ] `verify` passes.
- [ ] Manifest run ID matches logical run.
- [ ] Adapter identity matches immutable worker.
- [ ] Resume mode is `exact`, `boundary`, or `restart`.
- [ ] Project inputs and launch specification remain unchanged.
- [ ] No physical Job for the logical run remains active.

After request:

- [ ] Desired generation advances once to `run`.
- [ ] Exact/boundary mode includes the verified `resume_from`.
- [ ] Restart mode omits `resume_from`.
- [ ] Launch uses identical specification.
- [ ] New attempt and Job IDs are recorded.
- [ ] Startup receipt outcome is `resumed` when checkpoint restore occurs.
- [ ] Resume evidence identifies restored position.
- [ ] Status generation and physical identities match.
- [ ] First post-resume unit follows the checkpoint without duplicate or skipped
      work.
- [ ] Exact-mode comparison remains valid.

## Stop approval

Before request:

- [ ] Project policy authorizes stop at this point.
- [ ] Evidence used for the decision is allowed by the plan.
- [ ] Current desired generation and metrics are saved.
- [ ] Objective model or artifact selection remains separate.
- [ ] Active Job and next boundary are understood.

After request:

- [ ] Stop generation and revision, digest and reason, plus operator time are
      recorded.
- [ ] Receipt action is `stop` at that generation.
- [ ] Receipt includes final boundary and checkpoint.
- [ ] Observed state becomes `completed`.
- [ ] Physical Job exits successfully.
- [ ] Project finalization outputs pass their own audit.
- [ ] Final selected artifact follows registered selection policy.

## Abort approval

Before request:

- [ ] The run should be recorded as unsuccessful.
- [ ] Waiting for a safe boundary remains acceptable.
- [ ] Active Job is identified exactly.
- [ ] Diagnostic checkpoint contents are appropriate.

After request:

- [ ] Abort generation and reason are recorded.
- [ ] Receipt action is `abort`.
- [ ] Observed state becomes `aborted`.
- [ ] Physical nonzero exit is identified as intentional abort.
- [ ] Diagnostic checkpoint verifies when present.
- [ ] Follow-up work uses a new logical run when execution contract changes.

## Emergency cancellation

- [ ] Cooperative pause, stop, or abort cannot safely solve the incident in time.
- [ ] One physical Job ID is identified.
- [ ] Desired state and observed status plus logs and Job inspection are saved.
- [ ] Cancellation is authorized.
- [ ] Only that Job ID is canceled.
- [ ] Terminal physical stage is verified.
- [ ] Latest checkpoint is verified.
- [ ] Missing receipt is recorded explicitly.
- [ ] Recovery starts from latest proven boundary.
- [ ] Incident report explains why cooperative control was bypassed.

## Final audit

### Desired and observed state

- [ ] Final control revision and SHA-256 are recorded.
- [ ] Final generation and action are recorded.
- [ ] Final observed state is terminal.
- [ ] Status applied generation equals expected final generation.
- [ ] Final status attempt and Job IDs are known.

### Attempts and receipts

- [ ] Every physical attempt is listed.
- [ ] Every Job ID and terminal stage is listed.
- [ ] Every applied generation has one immutable receipt in the responsible
      attempt path.
- [ ] Receipt control revisions and SHA-256 values resolve to exact control
      bytes.
- [ ] Receipt physical identities match Job records.
- [ ] Every resume receipt carries adequate restore evidence.
- [ ] No conflicting immutable receipt exists.

### Checkpoints and artifacts

- [ ] Every checkpoint referenced by final status or a receipt exists.
- [ ] Every outer byte count and digest verifies.
- [ ] Every inner manifest parses.
- [ ] Every payload byte count and digest verifies.
- [ ] Adapter identity and boundary are consistent.
- [ ] Final application artifacts have separate manifests and checksums.
- [ ] No mutable reference is used as sole provenance.

### Launch and code

- [ ] Immutable launch specification exact bytes are retained.
- [ ] All attempts match that specification.
- [ ] Worker code and package revisions are retained.
- [ ] Input model and data revisions are retained.
- [ ] Secret values are absent from retained evidence.

### Reporting

- [ ] Report names logical run ID.
- [ ] Report distinguishes each physical attempt and Job.
- [ ] Report states final cooperative action and generation.
- [ ] Report states checkpoint and artifact verification results.
- [ ] Report identifies any emergency cancellation or missing receipt.
- [ ] Report states unresolved limitations plainly.
