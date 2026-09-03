# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.16.1`
- Source commit: `2ad2beadeabb875c030d0026b64f96317b4fbf5f`
- Package source: exact npm release `0.16.1`
- License: MIT
- Local changes: `index.ts` re-exports the pinned extension, the package manifest exposes the
  upstream skills, and `sync.ts` invokes the upstream Herdr synchronization command

The reviewed source provides workflow and controller commands, durable state, child workflow
scheduling, and the terminal viewer. Release `0.15.0` moved production workflow execution out of the
origin Pi process. One package-owned host is the normal state writer, and supervised child processes
run workflow and controller code. Patch `0.15.1` also stops temporary package-discovery hosts when
the real-Pi end-to-end tests finish. Patch `0.15.2` routes all origin-session deliveries through one
coordinator, waits for Pi to be idle with no pending messages, confirms each public session entry,
and adopts existing entries after restart. A live claim cannot renew itself to send another copy,
and an uncertain delivery stops instead of retrying. Patch `0.15.3` keeps claims valid while Pi is
busy, revalidates each claim before delivery, restores the workflow widget and scrolling, and
restores Escape-to-pause and in-place resume for origin-session interactions. Release `0.16.0`
routes the extension, CLI, and `piw` through one hosted client, replaces the production `piw` SQLite
reader with bounded host views, and adds reliable cold-start and live-view recovery. It also adds
`piw <runId> --once` and packed-package release checks for the Pi widget, workflow lifecycle, `piw`,
and an exact real-model submission. Patch `0.16.1` makes the Pi widget and `piw` use the same live
status. Interactive timeouts now count only active origin-session model turns and remain suspended
while the workflow is paused, Pi is disconnected, or the host is down.

The extension and host use a versioned local protocol with strict validation. Durable interaction
requests connect a workflow to its origin Pi session and survive Pi restarts. The host uses atomic
lifecycle changes, stale-run cancellation, typed claim loss, and exact-token lease renewal. An
expired or replaced owner cannot renew its lease or resume writes.

External effects use durable intent and receipt records. An effect with an uncertain result becomes
ambiguous and needs an explicit recovery decision. The package does not promise exactly-once
delivery when an external system cannot prove it.

This alpha release changes SQLite schema version 1 in place and removes embedded production
execution. It has no compatibility reader or fallback runtime. Before activation, back up and move
an incompatible `state.sqlite` file together with its `-wal` and `-shm` files. Pi Workflows then
creates new state. It does not change the incompatible files.

The package bundles the `pi-workflows`, `monitor`, `autoplan`, `autodoc`, and `autoimplement` skills
with the extension. It also ships the native Herdr plugin and workflow-to-piw actions. Pi package
filters can disable one skill, all skills, or the extension independently. Workflow runs and
controller state stay under Pi's user data directory as documented upstream.

The local synchronization wrapper contains no Herdr plugin identity, manifest, package path, or
mutation rule. It uses the pinned upstream CLI's versioned `herdr sync --json` contract.
