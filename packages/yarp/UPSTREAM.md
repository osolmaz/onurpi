# Upstream record

- Repository: https://github.com/osolmaz/yarp
- Commit: `29dce0333b5f4da8b901f95f2c049af7e1c45bcf`
- Retrieved: 2026-08-03
- License: MIT
- Local changes: none; `index.ts` only re-exports the pinned upstream extension

## Review

The review covered the Pi extension, generic output cap, ingest and result clients, bundled skill,
SQLite schema and archive implementation, command runner, CLI parsing, tests, package metadata, and
archive specification.

The extension uses Pi's documented `tool_execution_start`, `tool_call`, `tool_result`,
`tool_execution_end`, `message_end`, session lifecycle, and `pi.exec` APIs. It does not modify Pi
session state, Pi's persistent schema, project trust, provider credentials, or Pi internals.

The extension starts one session-scoped `yarp archive ingest` child process. It sends bounded framed
requests over local pipes, waits for commit acknowledgements, retries one unacknowledged request
after a transport failure, and closes the process at session shutdown. It also runs
`yarp --version`, `yarp rewrite`, `yarp result-reduce`, and `yarp archive restore` through
`pi.exec`.

YARP stores tool inputs and results in `~/.local/share/yarp/tool-calls.sqlite3`. For wrapped
commands it also stores exact stdout and stderr before and after pruning. It reads `fullOutputPath`
only from Pi's documented built-in Bash result metadata. The archive is private on POSIX systems,
content-addressed, compressed, transactionally written, integrity checked, and never uploaded or
served.

The global cap runs after typed summaries and defaults to 5,120 UTF-8 bytes. It keeps bounded text
from the beginning and end, preserves image order, and adds a local search marker. It commits an
exact recovery source before returning shortened output and fails open when capture or finalization
fails. `YARP_OUTPUT_CAP_BYTES` configures or disables this fallback.

The Rust binary executes only commands accepted by its fixed allowlist. It keeps stdout and stderr
separate, preserves child exit codes, bounds rendered output in memory, and restores raw output
after post-execution archive failures. Archive statistics and verification do not print stored
payloads. The explicit Skillflag commands materialize the bundled text skill in a temporary
directory and do not add a background process.

The archive can contain commands, source code, file contents, environment-derived values, and
secrets printed by tools. `YARP_ARCHIVE_DISABLED=1` disables capture and the generic cap;
`YARP_DISABLED=1` disables pruning while capture remains active.
