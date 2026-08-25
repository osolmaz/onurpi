# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.13.3`
- Source commit: `8c00a85a0834283a54d0274b153b89bf559fd185`
- Package source: exact npm release `0.13.3`
- License: MIT
- Local changes: `index.ts` re-exports the pinned extension, the package manifest exposes the
  upstream skills, and `sync.ts` invokes the upstream Herdr synchronization command

The reviewed source provides workflow and controller commands, model-managed workflow controls,
durable controller state, child workflow scheduling, and the standalone workflow host. Release
`0.13.3` replaces the workflow database contract in place. It normalizes workflow runs, attempts,
and source links while keeping Pi session entries as the main copy of interactive prompts and
assistant output.

Large text that must be stored outside the Pi session uses content-addressed blobs. The store keeps
one copy and deletes blobs when no record refers to them. Compact workflow events no longer repeat
prompt and output payloads. Pruning protects active work, pending follow-ups, live settings, leases,
effects, and continuation links before it removes old runs and unused blobs.

The new database contract has no migration or compatibility reader. The package rejects an older
database before it writes to it. Removing the old database creates a clean `0.13.3` store. Recovery
preserves interrupted attempt state and uses the same saved settings when an assistant response
continues that attempt.

The release bundles the `pi-workflows`, `monitor`, `autoplan`, `autodoc`, and `autoimplement` skills
with the extension. It also ships the native Herdr plugin and workflow-to-piw actions. Pi package
filters can disable one skill, all skills, or the extension independently. Workflow runs and
controller state stay under Pi's user data directory as documented upstream.

The local synchronization wrapper contains no Herdr plugin identity, manifest, package path, or
mutation rule. It uses the pinned upstream CLI's versioned `herdr sync --json` contract.
