# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.11.1`
- Source commit: `6a95b970a9a7ed240b5f92c857d22dcdbc38101b`
- Package source: exact npm release `0.11.1`
- License: MIT
- Local changes: `index.ts` re-exports the pinned extension, the package manifest exposes the
  upstream skills, and `sync.ts` invokes the upstream Herdr synchronization command

The reviewed source provides workflow and controller commands, model-managed workflow controls,
durable controller state, child workflow scheduling, and the standalone workflow host. Release
`0.11.1` includes the `0.11.0` planning and human-decision changes. It also adds verified Herdr
plugin synchronization and makes autoimplement challenge fixable blocker claims before stopping.

The release bundles the `pi-workflows`, `monitor`, `autoplan`, `autodoc`, and `autoimplement` skills
with the extension. It also ships the native Herdr plugin and workflow-to-piw actions. Pi package
filters can disable one skill, all skills, or the extension independently. Workflow runs and
controller state stay under Pi's user data directory as documented upstream.

The local synchronization wrapper contains no Herdr plugin identity, manifest, package path, or
mutation rule. It uses the pinned upstream CLI's versioned `herdr sync --json` contract.
