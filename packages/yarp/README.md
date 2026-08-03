# YARP

This package loads the YARP Pi extension from a pinned upstream commit. YARP archives every Pi tool
call in one private local SQLite database. It applies typed summaries to reviewed developer
commands, then caps remaining result text at 5,120 UTF-8 bytes by default. Exact recovery stays
available through the local archive.

Unsupported commands and rewrite failures execute unchanged. Initial archive failures block
execution so a tool call cannot run without its input record. Post-execution archive failures remain
visible and restore raw shell output when possible. A generic cap is applied only after its recovery
source commits.

## Binary

The extension requires the matching `yarp` binary on `PATH`:

```sh
cargo install \
  --git https://github.com/osolmaz/yarp.git \
  --rev 29dce0333b5f4da8b901f95f2c049af7e1c45bcf \
  --locked
```

The archive is stored at `~/.local/share/yarp/tool-calls.sqlite3`. Use `yarp archive stats`,
`yarp archive verify`, and `yarp archive prune --before <UTC timestamp>` to inspect or prune it
without printing stored payloads.

`YARP_OUTPUT_CAP_BYTES` sets an exact text budget from 1,024 through 16,777,216 bytes. Set it to `0`
to disable only the generic cap. `YARP_DISABLED=1` disables rewriting and pruning while keeping
archival active. `YARP_ARCHIVE_DISABLED=1` disables archival and therefore the generic cap.

## Pi contract

YARP uses Pi's documented tool lifecycle and `message_end` hooks. It does not modify Pi session
state, Pi's persistent schema, or Pi internals. A session-scoped `yarp archive ingest` child process
owns archive writes and stops when the Pi session shuts down.

The archive can contain commands, source code, tool inputs and outputs, and secrets printed by
tools. It remains local and has no telemetry or network sync.

See [UPSTREAM.md](UPSTREAM.md) for the reviewed source and security notes.
