# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.11.2`
- Source commit: `05fed72887f6f49b6d2933f98a6ec09159f10ac2`
- Package source: exact npm release `0.11.2`
- License: MIT
- Local changes: `index.ts` re-exports the pinned extension, the package manifest exposes the
  upstream skills, and `sync.ts` invokes the upstream Herdr synchronization command

The reviewed source provides workflow and controller commands, model-managed workflow controls,
durable controller state, child workflow scheduling, and the standalone workflow host. Release
`0.11.2` makes deferred workflow launches durable before acknowledgement, returns stable queued run
IDs, recovers interrupted activation, and reports activation failures to the model so it can correct
and restart the workflow.

The release bundles the `pi-workflows`, `monitor`, `autoplan`, `autodoc`, and `autoimplement` skills
with the extension. It also ships the native Herdr plugin and workflow-to-piw actions. Pi package
filters can disable one skill, all skills, or the extension independently. Workflow runs and
controller state stay under Pi's user data directory as documented upstream.

The local synchronization wrapper contains no Herdr plugin identity, manifest, package path, or
mutation rule. It uses the pinned upstream CLI's versioned `herdr sync --json` contract.
