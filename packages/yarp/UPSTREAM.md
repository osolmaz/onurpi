# Upstream record

| Item          | Reviewed value                                                  |
| ------------- | --------------------------------------------------------------- |
| Repository    | https://github.com/osolmaz/yarp                                 |
| Commit        | `73adf7d434cf41ee34834a3f13f1167dd43b1491`                      |
| Retrieved     | 2026-08-25                                                      |
| License       | MIT                                                             |
| Local changes | None. `index.ts` only re-exports the pinned upstream extension. |

## Review

The review covered the Pi extension, strict configuration and shell-plan parsers, generic and
recovery output limits, broker protocol, runtime path security, startup and client code, ingest and
result clients, bundled skill, SQLite schema and archive implementation, command runner, CLI
parsing, tests, package metadata, release workflow, and archive specification. `yarp-cli` is the
only published crate; rule-pack parsing and compilation are an internal module.

The extension uses Pi's documented `tool_execution_start`, `tool_call`, `tool_result`,
`tool_execution_end`, `message_end`, session lifecycle, and `pi.exec` APIs. It does not modify Pi
session state, Pi's persistent schema, project trust, provider credentials, or Pi internals.

The extension starts one session-scoped `yarp archive ingest` bridge. It sends bounded version-1
frames over local pipes, waits for commit acknowledgements, and closes the bridge at session
shutdown. Rust owns transport recovery. Capture operations can reconnect and replay with their
stable identity within the original deadline. Prune is sent once and reports an unknown outcome if
its acknowledgement is lost. TypeScript does not add another replay loop. The extension also runs
`yarp --version`, `yarp config show --json`, `yarp plan --json`, `yarp result-reduce`, and
`yarp archive restore` through `pi.exec`.

Rust owns the versioned TOML configuration schema and the shell command classification. The
TypeScript extension strictly validates both machine-readable responses. Invalid configuration
disables the extension for the session. Planning failures, malformed plans, impossible
rewrite/recovery combinations, and stale command matches preserve the original command. Their
non-recovery results still receive the archive-backed generic cap.

YARP stores tool inputs and results in the configured local SQLite archive, which defaults to
`~/.local/share/yarp/tool-calls.sqlite3`. One agent-neutral broker per canonical archive owns the
only normal writable SQLite connection. Session bridges connect over a private same-user Unix
socket. Startup is race-safe, queues and frames are bounded, clients receive round-robin service,
source order is preserved, and short fixed micro-batches use sequential savepoints and one outer
commit. The broker exits after a bounded idle period and opens no network port.

For wrapped commands YARP stores exact stdout and stderr before and after pruning. `yarp run` sends
private stream spools through the broker and waits for durable acknowledgement before it emits
output. The extension reads `fullOutputPath` only from Pi's documented built-in Bash result
metadata. Capture replay uses existing version-1 rows and exact content checks; no receipt table or
second store exists. The archive is private on POSIX systems, content-addressed, compressed,
transactionally written, integrity checked, and never uploaded or served.

The generic cap runs after typed summaries and defaults to 5,120 UTF-8 bytes. It applies to every
non-recovery result, including pass-through command output. It keeps bounded text from the beginning
and end, preserves image order, and adds a local search marker. It commits an exact recovery source
before returning shortened output and fails open when capture or finalization fails.

Direct `yarp search` and `yarp read` output uses independent limits, defaulting to 32,768 bytes and
1,900 lines. Search reduces context and displayed matches to fit. Exact reads reject oversized
ranges before stdout. Malformed-query diagnostics are bounded, and proven recovery output never
receives a second outer cap marker.

The Rust binary executes only commands accepted by its fixed allowlist. It keeps stdout and stderr
separate, preserves child exit codes, bounds rendered output in memory, and restores raw output
after post-execution archive failures. Archive initialization, migration, capture, and prune are
broker-owned. Statistics, verification, search, read, and restore use read-only archive access and
do not print stored payloads unless a requested recovery operation returns them. The explicit
Skillflag commands materialize the bundled text skill in a temporary directory and do not add a
background process.

The configuration file is written atomically with private POSIX permissions. It replaces the former
policy environment variables without compatibility aliases. The archive can contain commands, source
code, file contents, environment-derived values, and secrets printed by tools. `pruning.enabled` and
`archive.enabled` provide the corresponding opt-outs.
