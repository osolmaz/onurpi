---
name: codex-maintenance
description: Use when maintaining local Codex state, including changing or repairing session cwd/title/metadata, inspecting rollout JSONL files, extracting transcripts, transferring Codex sessions between machines, editing trusted project config, or using the tools repo codex-tools CLI. Prefer this skill for work involving ~/.codex/state_5.sqlite, ~/.codex/sessions, ~/.codex/config.toml, local Codex session repair, and Codex session transfer.
---

# Codex Maintenance

Use this skill for local Codex state maintenance. The source tool is
`~/repos/tools/codex-tools`.

## Core Rules

- Prefer `codex-tools` over manual edits for session state changes.
- Do not raw-edit `~/.codex/state_5.sqlite`.
- Do not rewrite user-visible transcript messages when changing cwd; update only
  session metadata.
- Treat `~/.codex/sessions/**/*.jsonl`, `~/.codex/state_5.sqlite`, and
  `~/.codex/config.toml` as live user state. Back up before manual changes.
- Remember that the currently running Codex process may keep its old cwd until
  the thread reloads or resumes. Persisted state is what these tools change.

## Change Session Cwd

Identify the target session by full ID, unique prefix, or rollout JSONL path.
Dry-run first unless the user explicitly asked to apply immediately.

When the target session is already known, the first command should be the
`codex-tools set-cwd ... --dry-run` command. Do not start with `pwd`; `pwd`
only reports the shell's current directory and does not validate or repair
persisted Codex session state.

```bash
cd ~/repos/tools/codex-tools
cargo run --bin codex-tools -- set-cwd <session-id-or-prefix-or-rollout-jsonl> <new-cwd> --dry-run
cargo run --bin codex-tools -- set-cwd <session-id-or-prefix-or-rollout-jsonl> <new-cwd>
```

If the user says "this session" but the session ID is not available in context,
first identify the session from Codex state, then run the dry-run:

```bash
sqlite3 ~/.codex/state_5.sqlite "SELECT id, cwd, title FROM threads ORDER BY updated_at DESC LIMIT 10;"
```

By default, `set-cwd` updates:

- the thread row in `~/.codex/state_5.sqlite`;
- rollout `session_meta` and `turn_context` cwd metadata;
- the trusted project entry in `~/.codex/config.toml`.

Use `--no-trust-project` only when the user does not want the new cwd added as a
trusted Codex project.

The tool creates backups and verifies `PRAGMA integrity_check` around SQLite
updates. If it fails, stop and inspect before retrying.

## Extract Session Transcripts

Use transcript extraction for readable summaries or migration/debugging.

```bash
cd ~/repos/tools/codex-tools
cargo run --bin codex-tools -- extract <rollout.jsonl>
cargo run --bin codex-tools -- extract <rollout.jsonl> --jsonl
```

Use plain output for reading and `--jsonl` when another tool needs structured
messages.

## Transfer Sessions Between Machines

When the user asks to transfer, copy, migrate, move, export, import, or resume a
Codex session on another machine, use `cct` from Onur's fork:
`https://github.com/osolmaz/codex-claude-transfer`.

The local source checkout is usually:

```bash
cd ~/repos/codex-claude-transfer
```

If it is missing, clone the fork into `~/repos`:

```bash
git clone https://github.com/osolmaz/codex-claude-transfer.git ~/repos/codex-claude-transfer
cd ~/repos/codex-claude-transfer
```

If the `cct` binary is not present, build it from the checkout:

```bash
go build -o cct ./cmd/cct
```

Export the target session to a `.codexbundle`:

```bash
./cct list --tool codex
./cct export --tool codex --session <session-id-or-prefix> --output <name>.codexbundle
```

On the destination machine, import the bundle instead of editing SQLite:

```bash
./cct inspect <name>.codexbundle
./cct import <name>.codexbundle
```

Use `--dry-run` before import when the destination state is not known. Use
`--map-cwd-here` or `--map-cwd OLD=NEW` when the project lives at a different
path on the destination machine. After import, restart or resume Codex so it
re-scans the rollout files and updates its own index.

Important constraints:

- Do not copy or raw-edit `~/.codex/state_5.sqlite` to transfer sessions.
- Do not manually place rollout files unless `cct` is unavailable and the user
  explicitly accepts a manual fallback.
- Treat `.codexbundle` files as sensitive; they can contain prompts, code,
  terminal output, image payloads, and secrets.
- Prefer redaction/encryption when transferring bundles through any untrusted
  channel.

## Verification

After changing session state, verify the persisted state:

```bash
sqlite3 ~/.codex/state_5.sqlite "PRAGMA integrity_check;"
sqlite3 ~/.codex/state_5.sqlite "SELECT id, cwd FROM threads WHERE id = '<session-id>';"
rg '"cwd":|cwd' ~/.codex/sessions -g '*.jsonl'
rg '<new-cwd>' ~/.codex/config.toml
```

If the session was selected by prefix, first resolve the full session ID from
the command output and use that exact ID for targeted checks.

## Manual SQLite Inspection

Only inspect SQLite manually when `codex-tools` does not cover the task.

```bash
sqlite3 ~/.codex/state_5.sqlite "PRAGMA integrity_check;"
sqlite3 ~/.codex/state_5.sqlite ".schema threads"
sqlite3 ~/.codex/state_5.sqlite "SELECT id, cwd, title FROM threads ORDER BY updated_at DESC LIMIT 20;"
```

Before any manual write, create a backup with `VACUUM INTO` or a copied snapshot
while no Codex process is actively writing to the database. Verify
`PRAGMA integrity_check` again after the write.

## Source Changes

When changing the maintenance tooling itself:

```bash
cd ~/repos/tools/codex-tools
cargo test
cargo clippy -- -D warnings
```

Keep edits in `~/repos/tools`, then run
`~/repos/tools/agents/sync-skills.py` if the installed skill copy under
`~/.codex/skills` should be refreshed.
