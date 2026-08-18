# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.9.1`
- Source commit: `1452fe137b08057f3e799d3498a44022831ced02`
- Package source: exact npm release `0.9.1`
- License: MIT
- Local changes: `index.ts` re-exports the pinned extension and the package manifest exposes the
  upstream skills

The reviewed source provides workflow and controller commands, model-managed workflow controls, the
built-in monitor workflow, durable controller state, child workflow scheduling, and the standalone
workflow host. Release `0.9.1` bundles the upstream `pi-workflows` and `monitor` skills with the
extension. It also ships the native Herdr plugin, the `pi-workflows herdr setup` command, and the
`Ctrl+Shift+R` workflow-to-piw action with split, tab, and workspace placement. The patch starts the
viewer from its plugin root, so package-relative entrypoints work after a placement is selected. Pi
package filters can disable one skill, all skills, or the extension independently. The release keeps
the existing durable workflow updates, optional multi-track progress, measured and source ETAs,
compact workflow step cards, report-every-check monitor behavior, and explicit paid-work approval
boundaries. Workflow runs and controller state stay under Pi's user data directory as documented
upstream. The wrapper adds no state or runtime behavior.
