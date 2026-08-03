# YARP

This package loads the YARP Pi extension from a pinned upstream commit. YARP archives every Pi tool
call in one private local SQLite database. It applies typed summaries to reviewed developer
commands, then caps remaining result text at 5,120 UTF-8 bytes by default. Exact omitted output
remains available through short local references.

Unsupported or ambiguous commands execute unchanged. Initial archive failures block execution so a
tool call cannot run without its input record. Post-execution archive failures remain visible and
restore raw shell output when possible. A generic cap is applied only after its recovery source
commits.

Direct `yarp search` and `yarp read` commands use separate configurable byte and line limits. Rust
classifies these commands through `yarp plan --json`, and the extension does not add another outer
cap marker to proven recovery output.

## Binary

The extension requires the matching `yarp` binary on `PATH`:

```sh
cargo install yarp-cli --version 0.2.0 --locked --force
```

## Configuration

YARP reads one versioned TOML file at `$XDG_CONFIG_HOME/yarp/config.toml`, falling back to
`$HOME/.config/yarp/config.toml`. A missing file uses defaults. Manage it through the binary:

```sh
yarp config init
yarp config show
yarp config set output.cap_bytes 8192
yarp config check
```

The file controls pruning, the ordinary output cap, recovery byte and line limits, archive capture
and location, and user-wide compiled rule packs. Configuration errors disable the Pi extension for
that session instead of applying partial settings.

The archive defaults to `~/.local/share/yarp/tool-calls.sqlite3`. Use `yarp archive stats` or
`yarp archive verify` for inspection. The separate `yarp archive prune --before <UTC timestamp>`
command removes old calls without printing stored payloads.

## Pi contract

YARP uses Pi's documented tool and session lifecycle hooks together with `message_end` and
`pi.exec`. It does not modify Pi session state, Pi's persistent schema, or Pi internals. A
session-scoped `yarp archive ingest` child process owns archive writes and stops when the Pi session
shuts down.

The configuration file and archive are YARP's only persistent data. The archive can contain
commands, source code, file contents, and secrets printed by tools. It remains local and has no
telemetry or network sync.

See [UPSTREAM.md](UPSTREAM.md) for the reviewed source and security notes.
