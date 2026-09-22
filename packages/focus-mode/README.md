# @onurpi/focus-mode

Cap how many Pi agents work at the same time. The first sessions that start working hold a slot, and
a prompt that arrives when the cap is full is refused before the model sees it. Your text goes back
into the editor so you can keep editing it, and you get a notification that names focus mode.

Pi has no cross-session presence API, so the cap is cooperative: it counts the sessions that load
this package, on this machine.

## What it does

| Moment                                  | Behaviour                                                              |
| --------------------------------------- | ---------------------------------------------------------------------- |
| A prompt arrives (`input`)              | Claim a slot, or refuse the prompt at the cap                          |
| Before a turn and before each tool call | Re-check the slot and converge when the count is over the cap          |
| A session settles or shuts down         | Release the slot                                                       |
| A claim sees no turn for 5 seconds      | Release the slot, because Pi refused the prompt before the run started |
| Two sessions claim at the same instant  | The session that started last yields, so the count returns to the cap  |

A refused prompt never reaches the model and adds nothing to the session transcript. The only
visible trace is the notification.

## Refusal and stop messages

```
Focus mode: 2 of 2 agents are working, so this prompt was not sent. Your text is back in the
editor. Finish or stop another session, then press Enter again.
```

```
Focus mode stopped this session: 3 agents were working and the cap is 2.
```

An attached image cannot be put back, because the editor drops its paste markers on submit and Pi
offers no way to restore them. The refusal says so:

```
… N images could not be restored.
```

## Configuration

The config file is `~/.pi/agent/focus-mode.json`. A missing file means the defaults. Invalid JSON
reports one message and keeps working.

| Key            | Default    | Rule                                                 |
| -------------- | ---------- | ---------------------------------------------------- |
| `enabled`      | `true`     | Off means every prompt passes and no slot is claimed |
| `maxAgents`    | `2`        | Whole number, clamped to 1 through 16                |
| `heartbeatMs`  | `5000`     | Clamped to 1000 through 60000                        |
| `staleMs`      | `20000`    | Raised to at least twice `heartbeatMs`               |
| `stopPollMs`   | `500`      | Clamped to 100 through 60000                         |
| `victimPolicy` | `"newest"` | `newest` or `oldest`                                 |
| `notify`       | `true`     | Turn the messages off and keep the gate              |

```json
{
  "maxAgents": 2,
  "victimPolicy": "newest"
}
```

## Commands and flags

| Command         | Meaning                                                           |
| --------------- | ----------------------------------------------------------------- |
| `/focus status` | The current count, the cap, and whether this session holds a slot |
| `/focus list`   | One line per holder: short id, pid, working directory, and age    |
| `/focus max N`  | Write a new cap for future sessions and this session              |
| `--focus-max N` | Run one session with another cap                                  |

The package writes nothing to the footer or the status bar. The count is visible only through
`/focus status` and `/focus list`.

## User state

| Path                             | Kind                                                  |
| -------------------------------- | ----------------------------------------------------- |
| `~/.pi/agent/focus-mode.json`    | Config, persistent user data                          |
| `~/.pi/agent/focus-mode/leases/` | One JSON lease per working session, runtime user data |

Removing both removes the feature's state. Nothing else in Pi's state directory is written.

## Install

```bash
pi install ./packages/focus-mode
```

Start new sessions afterwards, because the package loads at session start.

## Limits

- A session that does not load the package is invisible to the count.
- Coordination is per machine. A second machine is not counted.
- A refused prompt is not parked. Press Enter again once a slot frees.
- Images on a refused prompt are lost, and the refusal says how many.
- The stop lands at the victim's next check, up to `stopPollMs` later.
- `newest` can stop a long task that just started. Use `victimPolicy: "oldest"` for the opposite
  preference.
- A session that hangs while its process lives can be swept from the table after `staleMs`.
- A claim whose turn does not start within 5 seconds goes back. Pi can refuse a prompt after the
  input handler, for example when no model is selected or credentials fail, and then no settle event
  arrives. A slow preflight past those 5 seconds can let one run start without a lease.

## Verification

```bash
npm run check --workspace @onurpi/focus-mode
npm run slophammer --workspace @onurpi/focus-mode
```

The two-session acceptance test, which needs a person because the local command guard blocks
scripted keystrokes:

1. Start session A and submit a deliberately long prompt.
2. Start session B and submit a prompt whose text is a unique marker.
3. Session B refuses the prompt, the marker stays in B's editor, and the message names focus mode.
4. `grep` the marker in B's session file. It finds nothing, which proves the refusal kept the prompt
   out of the transcript.
5. Let A settle, then press Enter in B with the same text. It is accepted.

## Troubleshooting

| Symptom                                                      | Cause                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| Every prompt passes and the footer shows no count            | The package is not loaded, or `enabled` is `false`                  |
| A config message appears once per session                    | The config file has invalid JSON or an out-of-range value           |
| The count includes a session you closed                      | Its process is still alive, or its heartbeat has not gone stale yet |
| A message says focus mode could not check the other sessions | The store failed, so the prompt passed: the feature fails open      |

## Files

| File          | Role                                                      |
| ------------- | --------------------------------------------------------- |
| `index.ts`    | Pi wiring: hooks, timers, command, flag                   |
| `config.ts`   | Config reading, clamping, and writing                     |
| `store.ts`    | Lease paths, atomic claim, heartbeat, sweep, stop request |
| `gate.ts`     | Pure admission decision                                   |
| `converge.ts` | Pure over-cap victim rule                                 |
| `notice.ts`   | Every user-visible string                                 |
| `editor.ts`   | Restore a refused prompt into the editor                  |
