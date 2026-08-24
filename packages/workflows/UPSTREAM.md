# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.13.1`
- Source commit: `74583b9270d3b6349feec4c0c13ab89dffa3b4c6`
- Package source: exact npm release `0.13.1`
- License: MIT
- Local changes: `index.ts` re-exports the pinned extension, the package manifest exposes the
  upstream skills, and `sync.ts` invokes the upstream Herdr synchronization command

The reviewed source provides workflow and controller commands, model-managed workflow controls,
durable controller state, child workflow scheduling, and the standalone workflow host. Release
`0.13.1` adds prepared workspace handling and change-scoped verification for Autoimplement and
Autodoc. It compares eligible checks with the base revision, keeps base failures visible, and keeps
incomplete or unknown evidence explicit.

The release also bounds mechanical and semantic repair, restores undeclared tracked, untracked, and
ignored file changes, and validates publication, review, CI, and delivery against the prepared
workspace. It preserves the visible assistant-message output added in `0.13.0` and the
assistant-text behavior fixed in PR #55.

The release uses the transactional SQLite store introduced in `0.13.0`. Workflow recovery, queued
continuation ownership, hosted decisions, controller claims, and Monitor's authorized goal
completion remain part of the reviewed package.

The release bundles the `pi-workflows`, `monitor`, `autoplan`, `autodoc`, and `autoimplement` skills
with the extension. It also ships the native Herdr plugin and workflow-to-piw actions. Pi package
filters can disable one skill, all skills, or the extension independently. Workflow runs and
controller state stay under Pi's user data directory as documented upstream.

The local synchronization wrapper contains no Herdr plugin identity, manifest, package path, or
mutation rule. It uses the pinned upstream CLI's versioned `herdr sync --json` contract.
