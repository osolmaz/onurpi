# Upstream record

- Repository: https://github.com/osolmaz/yarp
- Commit: `e8e976c44a055c4f3945351cf8813e5b92340dd7`
- Retrieved: 2026-07-31
- License: no license file or package license declared at the reviewed commit
- Local changes: none; `index.ts` only re-exports the pinned upstream extension

## Review

The review covered `hooks/pi/yarp.ts`, `hooks/pi/yarp.test.ts`, `package.json`, `Cargo.toml`, and
all Rust source under `src/`. The extension intercepts `bash` and `exec_command` through Pi's public
`tool_call` hook. It executes only `yarp --version` and `yarp rewrite <command>` through `pi.exec`.
It does not read files, access credentials, make network requests, collect telemetry, change project
trust, override tools, or start background resources.

The Rust binary executes only commands accepted by its fixed allowlist. It keeps stdout and stderr
separate, preserves child exit codes, truncates output in memory, and does not persist command
output or history.
