# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.14.0`
- Source commit: `5ad289e69a4cb1dca9a7055cbd642572de458451`
- Package source: immutable Git dependency at the reviewed commit
- License: MIT
- Local changes: `index.ts` re-exports the pinned extension, the package manifest exposes the
  upstream skills, and `sync.ts` invokes the upstream Herdr synchronization command

The reviewed source provides workflow and controller commands, model-managed workflow controls,
durable controller state, child workflow scheduling, and the standalone workflow host. The reviewed
commit adds the incremental and virtualized `piw` viewer after release `0.14.0`. It keeps JSON Patch
for bounded viewer updates, pages replay data, shares watched-run projections, and uses bounded
node-owned graph cards. Its SQLite shape replaces the release schema in place. Existing release
state must be backed up and converted before this source is activated.

Release `0.14.0` also adds a verified terminal decision that can restart a supported completed,
failed, or cancelled workflow from its original input.

Workflow resume is idempotent and reports actionable paused and resumable state separately from the
durable lifecycle status. The bundled workflow skill maps explicit continue or resume requests
directly to the resume tool action. Autoplan, Autodoc, and Autoimplement now require an explicit
user request before they start.

Direct verified answers and periodic recovery use one atomic prepare-or-adopt path for deterministic
human-decision continuations. One attempt claims and starts the continuation. Compatible concurrent
attempts adopt it without changing the winning lease or starting the engine again. Prepared-launch
recovery keeps a temporarily blocked continuation activatable until the session can start it.

Large text that must be stored outside the Pi session uses content-addressed blobs. The store keeps
one copy and deletes blobs when no record refers to them. Pruning protects active work, pending
follow-ups, live settings, leases, effects, restart ancestry, and continuation links before it
removes old runs and unused blobs.

The package bundles the `pi-workflows`, `monitor`, `autoplan`, `autodoc`, and `autoimplement` skills
with the extension. It also ships the native Herdr plugin and workflow-to-piw actions. Pi package
filters can disable one skill, all skills, or the extension independently. Workflow runs and
controller state stay under Pi's user data directory as documented upstream.

The local synchronization wrapper contains no Herdr plugin identity, manifest, package path, or
mutation rule. It uses the pinned upstream CLI's versioned `herdr sync --json` contract.
