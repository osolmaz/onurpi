# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.12.0`
- Source commit: `8b9007121ff85c663694039897d9cfa0a7609b81`
- Package source: exact npm release `0.12.0`
- License: MIT
- Local changes: `index.ts` re-exports the pinned extension, the package manifest exposes the
  upstream skills, and `sync.ts` invokes the upstream Herdr synchronization command

The reviewed source provides workflow and controller commands, model-managed workflow controls,
durable controller state, child workflow scheduling, and the standalone workflow host. Release
`0.12.0` adds bounded Autoimplement timeout fallback, explicit no-deadline node support, durable
successor turns, the sanity-check workflow, and complete one-shot examples for built-in workflow
skills. It also binds review, CI, publication, and delivery work to current repository and
pull-request state.

The release bundles the `pi-workflows`, `monitor`, `autoplan`, `autodoc`, and `autoimplement` skills
with the extension. It also ships the native Herdr plugin and workflow-to-piw actions. Pi package
filters can disable one skill, all skills, or the extension independently. Workflow runs and
controller state stay under Pi's user data directory as documented upstream.

The local synchronization wrapper contains no Herdr plugin identity, manifest, package path, or
mutation rule. It uses the pinned upstream CLI's versioned `herdr sync --json` contract.
