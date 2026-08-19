# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.11.0`
- Source commit: `e32ab55228e8963eb7861f5dd5570a750426df1a`
- Package source: exact npm release `0.11.0`
- License: MIT
- Local changes: `index.ts` re-exports the pinned extension, the package manifest exposes the
  upstream skills, and `sync.ts` invokes the upstream Herdr synchronization command

The reviewed source provides workflow and controller commands, model-managed workflow controls,
durable controller state, child workflow scheduling, and the standalone workflow host. Release
`0.11.0` adds `autoplan` and `autodoc`, corrects the `autoimplement` plan-adoption path, adds typed
human decisions with Pi and Telegram channels, and renders human decisions as readable operator
presentations.

The release bundles the `pi-workflows`, `monitor`, `autoplan`, `autodoc`, and `autoimplement` skills
with the extension. It also ships the native Herdr plugin and workflow-to-piw actions. Pi package
filters can disable one skill, all skills, or the extension independently. Workflow runs and
controller state stay under Pi's user data directory as documented upstream.

The local synchronization wrapper contains no Herdr plugin identity, manifest, package path, or
mutation rule. It expects the pinned upstream CLI to provide the versioned `herdr sync --json`
contract. The OnurPi adoption must update this exact pin to the first reviewed release that includes
that command before the synchronization script is merged to the default branch.
