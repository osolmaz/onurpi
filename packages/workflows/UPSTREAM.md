# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.16.3`
- Source commit: `e296d00a8cf0dd1951ff6d8271e596ff0ecdb84b`
- Package source: exact npm release `0.16.3`
- License: MIT
- Local changes: `index.ts` re-exports the pinned extension, the package manifest exposes the
  upstream skills, and `sync.ts` invokes the upstream Herdr synchronization command

The reviewed source provides workflow and resource manager commands, durable state, runner
scheduling, and the terminal viewer. Release `0.15.0` moved production workflow execution out of the
origin Pi process. One package-owned server is the normal state writer, and supervised child runners
run workflow and resource manager code. Patch `0.15.1` also stops temporary package-discovery
servers when the real-Pi end-to-end tests finish. Patch `0.15.2` routes all origin-session
deliveries through one coordinator, waits for Pi to be idle with no pending messages, confirms each
public session entry, and adopts existing entries after restart. A live claim cannot renew itself to
send another copy, and an uncertain delivery stops instead of retrying. Patch `0.15.3` keeps claims
valid while Pi is busy, revalidates each claim before delivery, restores the workflow widget and
scrolling, and restores Escape-to-pause and in-place resume for origin-session interactions. Release
`0.16.0` routes the extension, CLI, and `piw` through one server client, replaces the production
`piw` SQLite reader with bounded server views, and adds reliable cold-start and live-view recovery.
It also adds `piw <runId> --once` and packed-package release checks for the Pi widget, workflow
lifecycle, `piw`, and an exact real-model submission. Patch `0.16.1` makes the Pi widget and `piw`
use the same live status. Interactive timeouts now count only active origin-session model turns and
remain suspended while the workflow is paused, Pi is disconnected, or the server is down. Patch
`0.16.2` makes the server the only authority for workflow-turn ownership. Provider failures,
terminal races, reconnects, and late reports cannot leave stale ownership or attach later chat turns
to old workflow work. Matching repeated reports return the saved result, while conflicting reports
remain errors. The release also gives managed effects full compiled identities, uses explicit runner
commands, commits terminal state before presentation, retries terminal presentation, and parks
runners that exit without progress with a clear recovery reason. Patch `0.16.3` keeps runner
continuation replies small by sending only current run state and keeping session history in
server-owned SQLite. Required large values use verified content references and bounded reads, and
pruning cannot delete response content while an active runner needs it. The release also completes
the public naming cutover to Workflow Server, Workflow Runner, Resource Manager, Resource Runner,
and Managed Resource.

The extension and server use a versioned local protocol with strict validation. Durable interaction
requests connect a workflow to its origin Pi session and survive Pi restarts. The server uses atomic
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
managed-resource state stay under Pi's user data directory as documented upstream.

The local synchronization wrapper contains no Herdr plugin identity, manifest, package path, or
mutation rule. It uses the pinned upstream CLI's versioned `herdr sync --json` contract.
