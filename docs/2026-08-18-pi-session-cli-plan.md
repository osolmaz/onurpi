---
title: Add the pi-session CLI
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-08-18
---

# Add the pi-session CLI

Onur wants a CLI that lets a new agent get up to date with an existing Pi session without adding an
agent tool or Pi extension. The main need is a small, reliable view that can filter the active
branch to user messages and final assistant messages while retaining the control events needed to
continue unfinished work. The command must avoid the context blowup that occurred when a 5.4 MB tool
result was read from a 101 MB session.

The command will be named `pi-session`. It will be a standalone CLI in OnurPi. It will not register
a Pi tool, slash command, hook, skill, or prompt resource.

## Requirements

- Accept an absolute session path, a full session UUID, or a unique UUID prefix.
- Resolve UUIDs within the current working directory by default. Require an explicit all-projects
  option for broader discovery.
- Use Pi's documented session APIs to reconstruct the active branch.
- Group active-branch entries into turns.
- Show exact user text and the final user-visible assistant response for each selected turn.
- Mark an interrupted turn when it has no final assistant response.
- Exclude assistant reasoning, signatures, images, raw custom metadata, and tool bodies by default.
- Preserve the high-signal control events needed for recovery:
  - plan changes;
  - workflow starts, updates, submissions, and terminal results;
  - tool failures;
  - edited and written file paths.
- Keep observed session evidence separate from conclusions. The CLI will not call a model or infer
  the current task, completion state, or next action.
- Bound every excerpt and the complete output. Never copy a large result to model context.
- Redact likely credentials and omit binary or base64 payloads.
- Support plain text for humans and agents, plus stable JSON for automation.
- Remain read-only. It must not switch, migrate, append, repair, rename, or delete sessions.

## Command interface

The default command prints a bounded recovery view of the last 20 turns:

```sh
pi-session 019fd7b1
pi-session /absolute/path/to/session.jsonl
```

Options:

```text
pi-session <session> [--last <count>]
                     [--assistant <final|text|none>]
                     [--include <workflow,plan,errors,files>]
                     [--since <timestamp|entry-id>]
                     [--format <text|json>]
                     [--all-projects]

pi-session list [--all-projects] [--limit <count>] [--format <text|json>]
pi-session entry <session> <entry-id> [--format <text|json>]
```

Defaults:

- `--last 20`
- `--assistant final`
- `--include workflow,plan,errors,files`
- `--format text`
- current-working-directory session lookup

`pi-session entry` is a bounded forensic view. It does not provide an unbounded raw-output option.
The original JSONL file remains the source for manual raw inspection.

## Turn and final-response rules

A turn starts at a user message and ends immediately before the next user message on the active
branch. Extension custom messages remain separate control events unless Pi records them as user
messages.

The final assistant response is the last assistant message in the turn that:

1. contains a non-empty visible text block;
2. contains no tool call; and
3. occurs after the turn's final tool result.

If no message satisfies all three rules, the output states:

```text
[No final response: turn was interrupted]
```

`--assistant text` includes all assistant messages with visible text and labels each as intermediate
or final. The CLI must not silently promote an intermediate progress message to a final response.

## Output shape

Plain text groups evidence by turn:

```text
Session: <uuid>
File: <path>
Entries: <count>
Active branch entries: <count>
Integrity: <status>
Showing: last <count> turns

Turn <number> · <timestamp>

USER
<exact bounded text>

ASSISTANT
<exact bounded final text or interruption marker>

CONTROL
<bounded workflow, plan, error, and file-path events>
```

JSON uses a versioned top-level object with these stable sections:

- `schema`
- `session`
- `integrity`
- `selection`
- `turns`
- `nextOffset`

Each turn contains its entry IDs and timestamps so a caller can request exact supporting evidence.
Do not add a database or persistent cache for version 1.

## Integrity and safety checks

Before rendering, check:

- header and session version;
- malformed JSONL records;
- duplicate entry IDs;
- missing parent IDs;
- parent cycles;
- missing or invalid active leaf;
- incomplete tool-call and tool-result pairs;
- empty assistant messages after a user message;
- oversized message or tool-result entries.

Structural problems appear in `integrity`; they do not trigger automatic repair. A valid file can
still contain an interrupted turn, failed compaction, or oversized result. Report these separately.

Apply limits before formatting:

- 2 KiB per normal message excerpt;
- 8 KiB per workflow or plan event;
- 40 KiB total plain-text output;
- 20 turns by default;
- no image data, thinking signatures, or full tool-result bodies.

Use Pi's truncation utilities for the final limit and state exactly what was omitted.

## Package design

Create a private workspace package:

```text
packages/pi-session/
├── package.json
├── README.md
├── src/
│   ├── args.ts
│   ├── cli.ts
│   ├── load.ts
│   ├── redact.ts
│   ├── render-json.ts
│   ├── render-text.ts
│   ├── select.ts
│   └── types.ts
├── test/
├── tsconfig.json
└── tsconfig.build.json
```

The package manifest will expose `dist/src/cli.js` as the `pi-session` binary. Keep the package
private. Build and link it locally; do not publish or claim a remote package name without separate
approval.

Use the installed `@earendil-works/pi-coding-agent` public API:

- `SessionManager.list()` and `SessionManager.listAll()` for discovery;
- `SessionManager.open()` for an exact file;
- `getEntries()` for integrity and forensic views;
- `getBranch()` for active-branch turn selection;
- Pi truncation helpers for bounded output.

The package must not appear in the root `pi.extensions`, `pi.skills`, `pi.prompts`, or `pi.themes`
manifest fields. It is a normal workspace CLI, not a Pi resource.

## Scope

Version 1 includes session discovery, active-branch turn filtering, control-event extraction,
bounded entry inspection, text output, JSON output, redaction, tests, build configuration, and local
CLI linking instructions.

## Non-goals

- A Pi extension or agent-facing tool.
- A TUI, browser, daemon, database, index, or background process.
- Semantic search across session history.
- Model-generated summaries or next-step recommendations.
- Session mutation, repair, migration, forking, resuming, or deletion.
- Raw unbounded transcript export.
- Supporting non-Pi session formats.
- Publishing the package to npm.

## Assumptions and open questions

- Pi's public `SessionManager` remains the authority for active-branch semantics.
- Loading an existing session through `SessionManager.open()` does not write to it unless an append
  or session mutation method is called. Add a test that verifies the source bytes and timestamps
  remain unchanged.
- Version 1 treats every recorded user-role message as user evidence. It does not guess whether text
  came from a human, prompt queue, workflow, or another extension when the session format does not
  record that origin.
- The exact credential-redaction patterns should reuse an existing OnurPi helper if one is
  available; otherwise, implement a narrow tested set without changing non-secret text.

## Acceptance criteria

- `pi-session <path-or-id>` prints the last 20 active-branch turns with user and final assistant
  text.
- Tool-only assistant messages and reasoning do not appear as final responses.
- Interrupted turns are marked instead of receiving an inferred response.
- Workflow contracts, plan changes, errors, and changed file paths remain available in bounded form.
- The 101 MB corrupted-session fixture or an equivalent generated fixture completes without placing
  a multi-megabyte value in stdout.
- A 5.4 MB tool result produces only bounded metadata and an omission notice.
- Branch tests prove that abandoned-branch messages do not appear in the default view.
- Secret, image, signature, malformed-entry, duplicate-ID, missing-parent, and cycle cases are
  tested.
- Text and JSON output are deterministic.
- Running the CLI leaves the session file byte-for-byte unchanged.
- `pi list` shows no new Pi resource because the package registers none.

## Verification

Run the package checks and real CLI cases:

```sh
npm run check --workspace @onurpi/pi-session
npm run build --workspace @onurpi/pi-session
node packages/pi-session/dist/src/cli.js --help
node packages/pi-session/dist/src/cli.js <fixture-session-id>
node packages/pi-session/dist/src/cli.js <fixture-session-id> --format json | jq -e .
```

Then run repository checks:

```sh
npm run check
npm run slophammer
git diff --check
npx -y @simpledoc/simpledoc check
```

Link the built CLI in a controlled local test and verify `pi-session --help`. Run it against a
copied large session fixture, compare the source hash and modification time before and after, and
confirm that stdout stays within the documented limit. Run `pi list` and confirm that no
`pi-session` extension or other Pi resource appears.

## Pi contract impact

- **Session state:** No session entries are appended or changed.
- **Other persistent data:** The built package and an explicit local CLI link are the only new local
  state. The CLI creates no cache, index, or daemon state.
- **Pi internals:** None.
- **Public API:** The CLI uses documented `SessionManager` read methods and exported truncation
  helpers. It does not register an extension API surface.
