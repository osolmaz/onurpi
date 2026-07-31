# YARP

This package loads the YARP Pi extension from a pinned upstream commit. YARP archives every Pi tool
call in one private local SQLite database. It also wraps a strict allowlist of developer commands
and removes the middle of long output before it enters Pi's context, while retaining exact raw
stdout and stderr for recovery.

Unsupported commands and rewrite failures run unchanged. Initial archive failures block execution so
a tool call cannot run without its input record. Post-execution archive failures remain visible and
restore raw shell output when possible.

## Binary

The extension requires the matching `yarp` binary on `PATH`:

```sh
cargo install \
  --git https://github.com/osolmaz/yarp.git \
  --rev 0d29a076d1066015b8b291fa32063fd8ff926e51 \
  --locked
```

The archive is stored at `~/.local/share/yarp/tool-calls.sqlite3`. Use `yarp archive stats`,
`yarp archive verify`, and `yarp archive prune --before <UTC timestamp>` to inspect or prune it
without printing stored payloads.

Set `YARP_DISABLED=1` to disable command rewriting while keeping archival active. Set
`YARP_ARCHIVE_DISABLED=1` to disable archival.

## Pi contract

YARP uses Pi's documented tool lifecycle and `message_end` hooks. It does not modify Pi session
state, Pi's persistent schema, or Pi internals. A session-scoped `yarp archive ingest` child process
owns archive writes and stops when the Pi session shuts down.

The archive can contain commands, source code, tool inputs and outputs, and secrets printed by
tools. It remains local and has no telemetry or network sync.

See [UPSTREAM.md](UPSTREAM.md) for the reviewed source and security notes.
