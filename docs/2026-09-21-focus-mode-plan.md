---
title: Focus mode, a cap on concurrent Pi agents
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-09-21
tags: [pi, focus-mode, extensions, concurrency, leases]
---

# Focus mode, a cap on concurrent Pi agents

## Purpose

Onur asked for a way to work on one agent at a time. Herdr has no such control, so the request moved
to Pi, in his words:

> could we build a focus mode extension that limits the max number of agents working at the same
> time? Actually not abort, or maybe it should abort. I don't know what's the best way. You can
> choose. It should be configurable. By default it should be two agents. If there are more than two
> agents running at the same time, it should select one and kill it. I'm not sure what the best
> algorithm is. If it already detects two agents, it should reject the user message as well. Maybe
> it just doesn't even make the request and interrupts before sending. You try to press Enter, it
> doesn't add it to the user message. The message stays in the input box.

The end state he asked for: a configurable cap on concurrent working Pi agents, checked before a
turn begins and before each tool call. At the cap, the prompt is refused before the model sees it,
the text stays in the input box so he can keep editing it, and a notification names focus mode as
the reason. Above the cap, exactly one working session stops.

Pi exposes no cross-session presence API, so the cap cannot be enforced from inside Pi. It is
cooperative across the sessions that load this package, and it needs one store the extension owns in
user state. This document is the canonical plan for the `@onurpi/focus-mode` package.

## Editor behaviour on a handled input

The gate is only useful if a refused prompt survives in the editor. Pi does not promise that in its
documentation, so the behaviour was measured first, at the installed Pi version 0.86.1:

1. `pi-tui/dist/components/editor.js:1138-1151` — `submitValue()` reads the submitted text, resets
   the editor state to one empty line, clears the paste markers, and only then calls
   `this.onSubmit(result)`.
2. `pi-coding-agent/dist/modes/interactive/interactive-mode.js:2539-2546` — the submit handler
   passes that text to the input callback. Nothing in this path clears the editor, because the
   editor already is empty.
3. `pi-coding-agent/dist/core/agent-session.js:838-851` — `prompt()` emits the `input` event and, on
   `handled`, returns before expanding, queueing, or sending anything. It never writes the editor.

So the editor is empty when the handler runs, and `handled` leaves it empty. A rejected prompt must
be put back with `ctx.ui.setEditorText(text)`. The extension always calls it on rejection.

The same measurement fixes the image case. `submitValue()` clears the editor's paste markers, and
the documented UI surface has no way to read or restore editor images. The handler can see
`event.images`, so the extension reports how many images were dropped in the notice, and the README
states the loss plainly instead of promising a restore it cannot do.

Two runtime details came from a throwaway probe, `/tmp/focus-mode-probe.ts`, which is outside this
repository:

- `ctx.ui.setEditorText` writes into the live TUI editor. The probe placed a marker string this way
  and the marker appeared on the editor line, so the restore path is a real, working interface.
- The probe could not submit that marker, because the local command guard blocks typed input to a
  running process. The editor branch above therefore comes from the Pi source at version 0.86.1
  rather than from a live keystroke test. The two-session recipe in `## Verification` is the
  acceptance test that closes this gap.

## Selected design: a lease directory with an input gate

A new package `packages/focus-mode` (`@onurpi/focus-mode`) holds one lease file per working session
and decides admission from that directory. The decision is a pure function of the lease list, the
config, and the prompt source, so the gate is readable and directly testable.

### User state

| Path                             | Kind               | Contents                                               |
| -------------------------------- | ------------------ | ------------------------------------------------------ |
| `~/.pi/agent/focus-mode.json`    | config, user data  | The cap and its timings. A missing file means defaults |
| `~/.pi/agent/focus-mode/leases/` | runtime, user data | One JSON lease per working session                     |

Both paths are persistent user data that this package owns. `rm -rf ~/.pi/agent/focus-mode` plus the
config file fully removes the feature's state. Nothing else in Pi's state directory is written.

### Lease file

```json
{
  "sessionId": "a1b2c3d4",
  "pid": 12345,
  "sessionFile": "/home/user/.pi/agent/sessions/--home-user-repo--/2026-09-21T04-50-00-…jsonl",
  "cwd": "/home/user/repo",
  "admittedAt": "2026-09-21T04:50:03.120Z",
  "heartbeatAt": "2026-09-21T04:50:08.120Z",
  "stopRequestedAt": null
}
```

`sessionId` is a short slug derived from the session file path, so one session owns exactly one
lease. A claim creates the file with an exclusive create (`flag: "wx"`), which no second session can
win. Later updates rewrite the same file. An unreadable or corrupt lease counts as absent and is
removed by the next sweep.

### Gate

The `input` handler runs before a turn begins, and `before_agent_start`, `turn_start`, and
`tool_call` re-check the lease afterwards. The rules:

1. A prompt whose source is `extension` continues and claims nothing, so a package that injects its
   own text is not counted as user work.
2. A session that already holds a live lease continues and refreshes its heartbeat. Steering and
   follow-up prompts from a holder also continue.
3. Otherwise the handler sweeps stale leases, counts the live ones, and claims a lease when the
   count is below the cap.
4. At the cap the handler rejects: it restores the text with `ctx.ui.setEditorText`, notifies, sets
   the footer status, and returns `{ action: "handled" }`. The model never runs, the transcript
   gains no entry, and the package never re-sends that text.
5. A claim made by rule 3 is provisional for five seconds. Pi can refuse the prompt after the
   `input` event, before any run starts, and then no settle event arrives. `before_agent_start` and
   `agent_start` confirm the claim, and a claim that no turn follows goes back after that window.

### Convergence over the cap

When two sessions sweep and claim in the same instant, the count can pass the cap by one. Every
session then re-checks at `before_agent_start`, `turn_start`, and `tool_call`, and the over-cap rule
picks one victim: the newest `admittedAt` first, because established work should continue and the
session that just started should yield. Ties prefer the current session, then the larger
`sessionId`, so every session picks the same victim without talking to the others. `victimPolicy`
switches the preference to `oldest` without a code change.

The stop is cooperative. The converger writes `stopRequestedAt` into the victim's lease file. The
victim notices on its 500 ms lease check or at its next hook, calls `ctx.abort()` inside its own
session, notifies, and releases. No signal is ever sent to another process, and this is why the plan
does not use the word that the request used: the enforced stop is an in-session abort, not a process
kill. A victim whose process died is swept instead.

### Surfaces

- `/focus status` prints the current count, the cap, and whether this session holds a lease.
- `/focus list` prints one line per live lease: session id, pid, working directory, and age.
- `/focus max N` writes the cap through the config reader, which preserves unknown keys.
- The `focus-max` flag sets the cap for one session only.
- The footer status key `focus-mode` shows `focus 2/2 · held` while a lease is held.

## Configuration

`~/.pi/agent/focus-mode.json`, read in the shape of `packages/image-budget/config.ts`. A missing
file means defaults, and invalid JSON reports one error without changing behaviour.

| Key            | Default    | Rule                                                       |
| -------------- | ---------- | ---------------------------------------------------------- |
| `enabled`      | `true`     | Off means every prompt passes and no lease is claimed      |
| `maxAgents`    | `2`        | Clamped to 1 through 16                                    |
| `heartbeatMs`  | `5000`     | Clamped to 1000 through 60000                              |
| `staleMs`      | `20000`    | Raised to at least twice `heartbeatMs`                     |
| `stopPollMs`   | `500`      | How often a holder checks its own lease for a stop request |
| `victimPolicy` | `"newest"` | `newest` or `oldest`                                       |
| `notify`       | `true`     | Turn the notifications off while keeping the gate          |

## Notification texts

Both messages name focus mode, as the request requires.

- Rejection:
  `Focus mode: 2 of 2 agents are working, so this prompt was not sent. Your text is back in the editor. Finish or stop another session, then press Enter again.`
  With images attached, the message adds `N image(s) could not be restored.`
- Self-stop: `Focus mode stopped this session: 3 agents were working and the cap is 2.`

## Safety rules

- Documented Pi extension interfaces only: the events above, `ctx.ui.notify`, `ctx.ui.setStatus`,
  `ctx.ui.getEditorText`, `ctx.ui.setEditorText`, `ctx.abort`, `ctx.sessionManager.getSessionFile`,
  `pi.registerCommand`, and `pi.registerFlag`. No Pi source change, no private API, no monkey patch,
  and no write into Pi's session file.
- No signal to another agent process. Liveness uses `/proc/<pid>` with a `process.kill(pid, 0)`
  fallback where `EPERM` counts as alive; that call sends nothing.
- No service, daemon, socket coordinator, or paid compute.
- Fail open. Every handler catches its own errors, notifies once per session, and lets the prompt
  continue, so a broken store never traps the user's work.
- The lease directory must stay on a local file system with working exclusive-create semantics, and
  the sweep removes any lease whose write failed.

## Verification

Local checks, run from `/home/onur/repos/onurpi`:

```bash
npm run check --workspace @onurpi/focus-mode      # format, lint, typecheck, test, coverage, dry
npm run slophammer --workspace @onurpi/focus-mode # production-file checks
npm run check                                     # repository-wide run, includes the new files
npx -y @simpledoc/simpledoc check                 # this document
```

Unit tests, one file per module:

| File               | Evidence                                                                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.test.ts`   | Defaults on a missing file, one error on malformed JSON, each clamp, the stale-to-heartbeat rule, a write round trip, unknown-key preservation                                                                               |
| `store.test.ts`    | Exclusive claim by two sessions, refresh, idempotent release, sweep on a dead pid, sweep on a stale heartbeat, corrupt-file tolerance, stop-request round trip                                                               |
| `gate.test.ts`     | Continue for a holder, continue for an extension prompt, allow below the cap, reject at the cap with counts                                                                                                                  |
| `converge.test.ts` | One agreed victim across sessions, self-stop when the current session is newest, the `oldest` policy, keep at or below the cap                                                                                               |
| `notice.test.ts`   | The exact texts, and a focus-mode mention in both messages                                                                                                                                                                   |
| `editor.test.ts`   | Restore when the editor is empty, no redundant write when it already holds the text, image reporting                                                                                                                         |
| `index.test.ts`    | Claim on the first prompt, reject at the cap with a restored editor and no session entry, release on `agent_settled`, self-abort on a stop request, a stop request written for a newer foreign lease, fail-open pass-through |

Two-session acceptance, on this machine:

1. Start session A with the package loaded and submit a deliberately long prompt.
2. Start session B with the same cap and submit a prompt whose text is a unique marker.
3. Session B must refuse the prompt, the marker must stay in B's editor, and the notice must name
   focus mode.
4. `grep` the marker in B's session file. It must find nothing, which proves the refused prompt
   never entered the transcript.
5. Let A settle, then press Enter in B with the same text. It must be accepted.

What this plan cannot test locally: a second machine, a Pi session that does not load the package,
and an image attached to a refused prompt. The acceptance run above is the only end-to-end evidence,
and the command guard blocks scripted keystrokes, so a person runs it.

## Known compromises

- The cap binds only sessions that load the package.
- Coordination is per machine.
- A refused prompt is not parked. The user presses Enter again after a slot frees, which is what the
  request asked for, and it differs from an automatic resume.
- A stop lands at the victim's next check, up to 500 ms later. A session that hangs while its
  process lives can be swept after `staleMs` even though it is still running.
- Newest-yields can stop a long task that just started. `/focus list` makes the current table
  visible, and `victimPolicy` changes the rule.
- Images on a refused prompt are lost, as the measurement above shows.

## Failure handling and rollout

| Failure                             | Behaviour                                                            |
| ----------------------------------- | -------------------------------------------------------------------- |
| Config file malformed               | One notification, defaults in effect, the gate keeps working         |
| Lease write fails                   | The prompt passes, and the sweep removes the failed lease            |
| Handler throws                      | The prompt passes with one notification, so the feature fails open   |
| Pi process dies                     | The next sweep removes the lease by pid liveness, or after `staleMs` |
| A session hangs                     | Its heartbeat goes stale and the sweep frees the slot                |
| Pi refuses the prompt after `input` | No turn starts, so the claim goes back after 5 seconds               |

Rollout: install with `pi install ./packages/focus-mode`, then start new sessions so the package
loads. Removal deletes the package plus `~/.pi/agent/focus-mode` and `~/.pi/agent/focus-mode.json`.
No migration applies, because the package is new and owns no existing state.

## Excluded work

- No Pi source change and no private API.
- No herdr change and no herdr-side limiter.
- No counting or stopping of Codex, Claude, OpenClaw, or any non-Pi session.
- No other repository, no service or daemon, no paid compute.
- No parked-prompt queue and no automatic re-send.
- No cross-machine coordination and no change to another package's public API.

## Relationship to the ideal

The ideal is a scheduler inside Pi: a machine-wide presence registry that owns the leases, an input
result that holds a prompt with its images and attachments intact, and a pause that works between
turns and tool calls, so enforcement is scheduling rather than refusal. That needs Pi itself, and
this plan may not change Pi. The design above is the cooperative, single-machine version of the same
user-facing outcome: a configurable cap, a gate before the turn and before each tool call, a refusal
that preserves the text for editing, a notification that names focus mode, and a graceful stop. When
Pi gains those primitives, only `store.ts` disappears, because the policy modules take their input
from a lease list rather than from the file system.
