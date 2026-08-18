# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.10.0`
- Source commit: `a89b5862d8f58197cf1fe14880c1d1ce7d6d9a35`
- Package source: exact npm release `0.10.0`
- License: MIT
- Local changes: `index.ts` re-exports the pinned extension and the package manifest exposes the
  upstream skills

The reviewed source provides workflow and controller commands, model-managed workflow controls,
durable controller state, child workflow scheduling, and the standalone workflow host. Release
`0.10.0` adds typed nested workflow composition with validated inputs and named exits, exact source
attestation, safe resume, and hierarchical viewer labels. It ships built-in `autodevise`,
`autoimplement`, and `monitor` workflows. Autoimplement tracks review findings from P0 through P2,
corrects reviewer commands, and uses bounded CI waits for more local testing. Monitor remains
observation-only unless its input explicitly authorizes repair.

The release bundles the upstream `pi-workflows` and `monitor` skills with the extension. It also
ships the native Herdr plugin and the workflow-to-piw actions. Pi package filters can disable one
skill, all skills, or the extension independently. Workflow runs and controller state stay under
Pi's user data directory as documented upstream. The wrapper adds no state or runtime behavior.
