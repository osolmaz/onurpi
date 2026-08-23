# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.13.0`
- Source commit: `fee9e18fee855a6413b47ed750bc336ce998b2f0`
- Package source: exact npm release `0.13.0`
- License: MIT
- Local changes: `index.ts` re-exports the pinned extension, the package manifest exposes the
  upstream skills, and `sync.ts` invokes the upstream Herdr synchronization command

The reviewed source provides workflow and controller commands, model-managed workflow controls,
durable controller state, child workflow scheduling, and the standalone workflow host. Release
`0.13.0` adds visible assistant-message output for agent steps and the reusable `plain-summary`
workflow. Autoplan and Sanity Check use it for short plain-language summaries. Sanity Check first
shows its complete verified report and keeps its strict verdict unchanged.

The release also moves workflow and controller state to one transactional SQLite store. It improves
workflow recovery, queued continuation ownership, hosted decisions, controller claims, and Monitor's
authorized goal completion. Sanity Check children keep their exact provider and model rules from
`0.12.1`.

The release bundles the `pi-workflows`, `monitor`, `autoplan`, `autodoc`, and `autoimplement` skills
with the extension. It also ships the native Herdr plugin and workflow-to-piw actions. Pi package
filters can disable one skill, all skills, or the extension independently. Workflow runs and
controller state stay under Pi's user data directory as documented upstream.

The local synchronization wrapper contains no Herdr plugin identity, manifest, package path, or
mutation rule. It uses the pinned upstream CLI's versioned `herdr sync --json` contract.
