# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.12.1`
- Source commit: `22b6aad8188631ce89273c6965cdf034112f3913`
- Package source: exact npm release `0.12.1`
- License: MIT
- Local changes: `index.ts` re-exports the pinned extension, the package manifest exposes the
  upstream skills, and `sync.ts` invokes the upstream Herdr synchronization command

The reviewed source provides workflow and controller commands, model-managed workflow controls,
durable controller state, child workflow scheduling, and the standalone workflow host. Release
`0.12.1` keeps the 0.12.0 workflow features and fixes Sanity Check child sessions. Each child now
loads the extension that owns the exact configured provider, rejects provider or model fallback,
keeps workflow controls unavailable, and shuts down admitted extensions on all completion and
failure paths.

The release bundles the `pi-workflows`, `monitor`, `autoplan`, `autodoc`, and `autoimplement` skills
with the extension. It also ships the native Herdr plugin and workflow-to-piw actions. Pi package
filters can disable one skill, all skills, or the extension independently. Workflow runs and
controller state stay under Pi's user data directory as documented upstream.

The local synchronization wrapper contains no Herdr plugin identity, manifest, package path, or
mutation rule. It uses the pinned upstream CLI's versioned `herdr sync --json` contract.
