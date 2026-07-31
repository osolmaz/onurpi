# @onurpi/goal

Bounded autonomous goals for the Pi coding agent.

This package is a reviewed fork of [`pi-goal`](https://github.com/Michaelliv/pi-goal). It keeps an active objective in the current Pi session and starts another agent run after the previous run fully settles. The agent stops when it marks the objective complete, the user pauses or clears it, the optional token budget is reached, or the safety policy pauses it.

## Commands

```text
/goal [--tokens 50k] <objective>
/goal status
/goal pause
/goal resume
/goal clear
/goal statusbar on|off
```

`/goal resume` starts a new safety checkpoint period. It keeps total usage and the total automatic-run count, but clears recent outcome fingerprints and the runs counted toward the next checkpoint.

## Tools

`create_goal` sets or replaces a goal only after an explicit user request. `get_goal` returns the active objective with its usage and safety state. `update_goal` accepts only `status: "complete"` after a concrete evidence audit.

`get_goal` and `update_goal` are active only while a goal is running. `create_goal` remains available so an explicitly requested goal can be created or replaced.

## Run lifecycle

Goal waits for Pi's documented `agent_settled` event. Automatic retries, context compaction, queued messages, and the current agent loop therefore finish before Goal starts another run.

Each settled goal run produces one compact accounting snapshot. Static completion rules and the current objective are injected through `before_agent_start`. Repeated continuation messages contain only a short instruction, so a long goal does not copy the full objective and audit checklist into every transcript row.

An active goal restored from disk is paused instead of continuing silently. Use `/goal resume` to start it again.

## Safety policy

Goal pauses when:

- The final assistant response is interrupted.
- The final assistant response ends in a terminal error after Pi's retry policy settles.
- The same outcome cycle, with a period of one to four runs, repeats three times.
- Twenty automatic runs finish since the goal started or was last resumed.
- The bundled Loop Guard emits a version-one `nudge` or `trip` event while the goal is active.

Outcome fingerprints cover model text, tool calls, and tool results while excluding volatile IDs, timestamps, usage, model, provider, and API fields. Only bounded `v1:` SHA-256 hashes are stored. Raw model output and tool data are not copied into safety state. A changing fingerprint is not treated as proof of progress; the 20-run checkpoint remains the final bound.

Safety pauses never call another model. They leave the goal paused with a reason and require `/goal resume` or a replacement goal.

## Persistence

Goal uses the upstream `pi-goal` custom session entry and `pi-goal-event` message types. State follows Pi's active branch. Existing upstream version-one state is normalized with empty safety counters when loaded.

The package does not write sidecar files, alter normal Pi messages, change compaction data, intercept providers, or use Pi internals.

## Development

```bash
npm run check
npm run slophammer
```

Mutation testing remains manual:

```bash
npm run mutate
```

See [UPSTREAM.md](UPSTREAM.md) for provenance and local changes. The vendored upstream code remains under the [MIT license](LICENSE).
