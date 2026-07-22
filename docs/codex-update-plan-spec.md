# Codex `update_plan` behavior specification

This specification describes Codex's `update_plan` checklist tool. It covers the request shape,
update semantics, runtime events, terminal rendering, and persistence behavior needed to reproduce
the feature.

The reference implementation is OpenAI Codex at commit
[`65ae4c26e088913176a50d6daeb742d00942caee`](https://github.com/openai/codex/tree/65ae4c26e088913176a50d6daeb742d00942caee),
inspected on July 22, 2026. The checklist tool is separate from Codex Plan mode.

## Minimal update

A plan update is one `update_plan` function call containing the complete current checklist:

```json
{
  "plan": [
    { "step": "Inspect the implementation", "status": "completed" },
    { "step": "Add the behavior", "status": "in_progress" },
    { "step": "Run the checks", "status": "pending" }
  ]
}
```

An update may explain why the checklist changed:

```json
{
  "explanation": "The existing parser already handles the input, so the plan now focuses on rendering.",
  "plan": [
    { "step": "Inspect the implementation", "status": "completed" },
    { "step": "Update the renderer", "status": "in_progress" },
    { "step": "Run the checks", "status": "pending" }
  ]
}
```

## Request model

Codex defines one request object with an optional explanation and a required plan array. Each plan
item contains only its text and status. The Rust
[`plan_tool.rs` protocol types](https://github.com/openai/codex/blob/65ae4c26e088913176a50d6daeb742d00942caee/codex-rs/protocol/src/plan_tool.rs#L7-L29)
reject unknown fields in both objects.

| Field           | Required | Type   | Meaning                                         |
| --------------- | -------- | ------ | ----------------------------------------------- |
| `plan`          | Yes      | array  | Complete checklist snapshot for this update.    |
| `explanation`   | No       | string | Short reason for creating or changing the plan. |
| `plan[].step`   | Yes      | string | Human-readable step text.                       |
| `plan[].status` | Yes      | enum   | Current state of the step.                      |

### Status values

| Value         | Meaning                               |
| ------------- | ------------------------------------- |
| `pending`     | Work on the step has not started.     |
| `in_progress` | The agent is working on the step now. |
| `completed`   | The step is finished.                 |

Codex has no blocked, cancelled, failed, or deleted status. A changed requirement is represented by
sending a new snapshot with the desired steps.

## Validation

The
[`plan_spec.rs` tool schema](https://github.com/openai/codex/blob/65ae4c26e088913176a50d6daeb742d00942caee/codex-rs/core/src/tools/handlers/plan_spec.rs#L7-L57)
requires `plan`, `step`, and `status`. It limits status to the three values above and disallows
extra properties.

The runtime applies these hard rules:

- `plan` must be an array.
- Every item must contain string `step` and a valid `status`.
- Unknown top-level and item fields are rejected.
- Wrong JSON types and unknown status values are rejected.

The runtime accepts several values that a stricter task manager might reject:

- `plan` may be empty.
- Step text may be empty.
- Step text does not have a length limit.
- Duplicate steps are accepted.
- Any number of steps may be supplied.
- Status transitions are not checked against earlier updates.

The tool description tells the model to keep at most one step `in_progress`. The handler does not
enforce that rule. A request containing several active steps parses successfully. The tool
declaration also sets `strict` to `false`, although the Rust decoder still rejects unknown fields.

## Snapshot semantics

Every call supplies a self-contained snapshot. Codex does not assign step IDs, merge updates, or
maintain a plan object inside the handler. The
[`plan.rs` handler](https://github.com/openai/codex/blob/65ae4c26e088913176a50d6daeb742d00942caee/codex-rs/core/src/tools/handlers/plan.rs#L62-L105)
parses the request and immediately emits the full list as a `PlanUpdate` event.

A conforming caller therefore repeats unchanged items whenever one item changes:

```json
{
  "plan": [
    { "step": "Inspect the implementation", "status": "completed" },
    { "step": "Add the behavior", "status": "completed" },
    { "step": "Run the checks", "status": "in_progress" }
  ]
}
```

Sending only `Run the checks` would produce a one-item snapshot. Codex has no previous-plan merge
step that restores omitted items.

List order is display order. Reordering the array reorders the rendered checklist. Because items
have no IDs, Codex does not expose rename, move, or patch operations as separate concepts.

An empty `plan` clears the latest completed-versus-total progress value. The transcript still
receives an `Updated Plan` cell containing `(no steps provided)`.

## Agent policy

Codex's bundled GPT-5.2 instructions give the model three usage rules:

- Skip the planning tool for roughly the easiest quarter of tasks.
- Do not create one-step plans.
- Update an existing plan after completing one of its shared steps.

The handler does not enforce the rules from the bundled
[`Plan tool` instruction section](https://github.com/openai/codex/blob/65ae4c26e088913176a50d6daeb742d00942caee/codex-rs/core/templates/model_instructions/gpt-5.2-codex_instructions_template.md#L57-L62).

A typical run begins with a short multi-step plan before substantial work. The model marks one step
`in_progress`. After that step finishes, it sends the complete list again with the finished step
marked `completed` and the next step marked `in_progress`.

## Runtime lifecycle

For a successful direct tool call, Codex performs these operations in order:

1. Parse the function arguments as `UpdatePlanArgs`.
2. Reject the call if the turn is running in Codex Plan mode.
3. Emit `EventMsg::PlanUpdate` with the complete request object.
4. Return a successful function output containing the text `Plan updated`.

The direct function output has `success: true`. When `update_plan` runs as a nested Code Mode tool,
its JavaScript-visible result is an empty object. The
[`PlanToolOutput` implementation](https://github.com/openai/codex/blob/65ae4c26e088913176a50d6daeb742d00942caee/codex-rs/core/src/tools/handlers/plan.rs#L22-L45)
defines both paths.

Codex registers the handler with its ordinary core utility tools. Guardian reviewer sessions return
before general utility tools are added, as shown by the
[`add_tool_sources` flow](https://github.com/openai/codex/blob/65ae4c26e088913176a50d6daeb742d00942caee/codex-rs/core/src/tools/spec_plan.rs#L564-L605)
and the
[`PlanHandler` registration](https://github.com/openai/codex/blob/65ae4c26e088913176a50d6daeb742d00942caee/codex-rs/core/src/tools/spec_plan.rs#L687-L696).

## Terminal projection

The Codex TUI treats each `PlanUpdate` event as a new transcript item. Its
[`on_plan_update` handler](https://github.com/openai/codex/blob/65ae4c26e088913176a50d6daeb742d00942caee/codex-rs/tui/src/chatwidget/turn_runtime.rs#L507-L520)
computes `completed / total` from the received snapshot, stores that count as the latest task
progress, refreshes status surfaces, and appends the full update to history. Pending and active
steps do not count as completed.

The transcript cell starts with `Updated Plan`. An explanation is trimmed, rendered in dim italic
text, and omitted when blank. Steps use these styles:

| Status        | Marker | Style               |
| ------------- | ------ | ------------------- |
| `pending`     | `□`    | Dim                 |
| `in_progress` | `□`    | Cyan and bold       |
| `completed`   | `✔`    | Dim and crossed out |

The
[`plans.rs` renderer](https://github.com/openai/codex/blob/65ae4c26e088913176a50d6daeb742d00942caee/codex-rs/tui/src/history_cell/plans.rs#L169-L246)
wraps long explanations and step text to the available terminal width. Earlier update cells remain
in transcript history while the newest snapshot supplies the current progress count.

When the terminal title is configured to show task progress, Codex formats the latest non-empty
snapshot as `Tasks <completed>/<total>`.

## App-server projection

The app server forwards each update as `turn/plan/updated` data associated with the current thread
and turn. The notification contains:

```json
{
  "threadId": "thread-id",
  "turnId": "turn-id",
  "explanation": "Optional explanation",
  "plan": [{ "step": "Run the checks", "status": "inProgress" }]
}
```

The
[`turn.rs` wire types](https://github.com/openai/codex/blob/65ae4c26e088913176a50d6daeb742d00942caee/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L425-L466)
use camel-case field and enum names. Their three statuses map directly from the core statuses. The
[`handle_turn_plan_update` forwarding path](https://github.com/openai/codex/blob/65ae4c26e088913176a50d6daeb742d00942caee/codex-rs/app-server/src/bespoke_event_handling.rs#L1227-L1246)
does not merge or otherwise transform the plan beyond this name mapping.

## Persistence

Codex persists the model's function call and the `Plan updated` function output as ordinary response
items. The
[`policy.rs` response-item rules](https://github.com/openai/codex/blob/65ae4c26e088913176a50d6daeb742d00942caee/codex-rs/rollout/src/policy.rs#L37-L58)
explicitly retain both `FunctionCall` and `FunctionCallOutput`.

The derived `PlanUpdate` event is transient. The
[`policy.rs` event rules](https://github.com/openai/codex/blob/65ae4c26e088913176a50d6daeb742d00942caee/codex-rs/rollout/src/policy.rs#L145-L175)
exclude it from rollout event persistence.

This produces two distinct records:

- The raw tool call preserves the submitted checklist as part of conversation history.
- The `PlanUpdate` event drives live UI and app-server projections without creating a second durable
  plan record.

Codex does not maintain a separate plan database, sidecar file, or mutable task table in this path.
The dedicated TUI progress value is process state derived from live events. The persistence contract
does not guarantee that an old plan update will be independently replayed after restart or remain
directly available after its raw tool call has been folded into compacted context.

## Errors

Malformed arguments return a tool error beginning with:

```text
failed to parse function arguments:
```

A non-function payload returns:

```text
update_plan handler received unsupported payload
```

A call made during Codex Plan mode returns:

```text
update_plan is a TODO/checklist tool and is not allowed in Plan mode
```

A successful direct call returns:

```text
Plan updated
```

Errors do not emit a `PlanUpdate` event.

## Boundaries

This specification covers the `update_plan` checklist tool. It does not cover Codex Plan mode,
proposed-plan streaming, project issue tracking, user-editable task lists, automatic completion
detection, or external task storage.

The observed Codex behavior also does not provide:

- stable step IDs
- per-step metadata or priorities
- dependencies between steps
- blocked, failed, or cancelled states
- automatic transition validation
- automatic proof that completed work passed its checks

Those features are extensions to the contract and fall outside a faithful reproduction.

## Conformance cases

A compatible implementation should verify at least these cases:

1. A valid three-step snapshot emits one update and returns success.
2. A later full snapshot replaces the current projection without merging against the earlier list.
3. Reordering the array changes display order.
4. An empty array clears the current progress count and renders an empty-plan update.
5. Missing `plan`, `step`, or `status` is rejected.
6. Unknown fields and unknown statuses are rejected.
7. Duplicate and empty step text is accepted.
8. Several `in_progress` items are accepted by the runtime even though they violate model guidance.
9. A Plan mode call is rejected without emitting an update.
10. The function call and output are durable while the derived update event remains transient.
