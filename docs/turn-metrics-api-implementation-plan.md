# Turn metrics API implementation plan

## Goal

Give Pi extensions a single, branch-aware view of logical turns and their derived metrics. Turn-fold
should consume that view instead of reconstructing turns from transcript rendering, timestamps, or
extension-local event state.

The design must correctly represent both of these cases:

```text
user: first instruction
assistant: response
user: follow-up
assistant: response
```

```text
user: workflow instruction A
user: workflow instruction B
assistant: one response to the delivered batch
```

The second sequence occurs when Pi drains a queue in `all` mode. The transcript alone cannot say
whether its adjacent user messages were intentionally delivered as one batch or were separate user
turns. A production implementation needs one small durable grouping fact; it must not persist
separate telemetry records or cached metric totals.

## Proposed contract

A **logical turn** is a batch of user messages delivered to an agent loop, together with every
assistant message and tool result produced until Pi delivers another user-message batch.

It is deliberately different from a model turn. A tool-using agent may make several model requests
inside one logical turn. Conversely, queued user messages can become either one logical turn or
multiple logical turns depending on Pi's configured queue-draining mode:

| Delivery mode                      | Drained messages             | Logical turns     |
| ---------------------------------- | ---------------------------- | ----------------- |
| Normal prompt                      | One user message             | One               |
| `one-at-a-time` steering/follow-up | One queued message           | One per message   |
| `all` steering/follow-up           | All queued messages together | One for the batch |

Pi core assigns an opaque, monotonically increasing `turnId` when it starts such a batch. Every
persisted message entry created for that logical turn receives the same ID. The ID is grouping
metadata only; Pi derives token and tool totals from the final messages whenever a caller asks.

## The long-term target

The target is a Pi-core `getBranchTurnMetrics()` API backed by session-owned turn IDs:

```ts
type TurnMetric = {
  turnId: number;
  entryIds: readonly string[];
  userEntryIds: readonly string[];
  assistantEntryIds: readonly string[];
  startedAt: number;
  endedAt: number | undefined;
  settled: boolean;
  assistantResponses: number;
  outputTokens: number;
  outputApproximate: boolean;
  toolCalls: number;
  failedToolCalls: number;
  grouping: "persisted" | "inferred";
};

interface ReadonlySessionManager {
  getBranchTurnMetrics(): readonly TurnMetric[];
  getTurnMetric(turnId: number): TurnMetric | undefined;
}
```

The API returns only data for the current branch and preserves branch order. It returns immutable
snapshots so extensions cannot alter session state. A companion entry lookup may be added only if a
consumer demonstrably needs it:

```ts
getTurnIdForEntry(entryId: string): number | undefined;
```

This is the desired architecture because all consumers use the same definition: transcript folding,
export, usage views, future status UIs, and SDK clients. Extensions do not communicate with each
other and do not need to infer queue behavior.

## Storage model

Add one optional field to Pi's existing `SessionMessageEntry` envelope:

```ts
interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage;
  turnId?: number;
}
```

Do not add a `turn` entry type. Do not append custom telemetry entries. Do not persist token totals,
tool counts, elapsed time, or render state.

A small integer is preferable to a UUID because it is sufficient within one session file, compact in
JSONL, stable across branches, and easy to inspect. Pi initializes the next value by scanning the
session's existing message entries for the largest valid `turnId` and adding one. Branches keep IDs
from their shared ancestry; new messages use fresh IDs for the whole session file.

This is the minimum durable information required for exact reconstruction. Without it, the same
persisted sequence of messages can represent either a batched workflow submission or separate
interactions. No parser can recover that distinction after restart.

Derived metrics remain storage-free:

- A positive finite `usage.output` contributes an exact output-token count.
- Missing, zero, malformed, or non-finite usage estimates finalized text, thinking, and tool-call
  content at four characters per token.
- Empty output contributes exact zero.
- Tool IDs and failed tool results come from the messages already in the branch.

## Pi-core implementation

### 1. Extend the session schema

1. Add optional `turnId` to the TypeScript session-entry types and JSONL validation.
2. Update session read, clone, branch, export, and compaction code to preserve the field unchanged.
3. Do not rewrite old sessions. Entries without an ID remain valid.
4. Keep `turnId` out of `AgentMessage` so providers and model context never receive session-only
   metadata.

### 2. Assign IDs at the delivery boundary

Create a session-owned turn coordinator in `AgentSession`. It owns the active logical turn and calls
an internal `appendMessage(message, { turnId })` path whenever Pi persists a message.

Assign the ID when Pi begins a prompt batch, including:

- the initial prompt submitted to `agent.prompt()`;
- a batch returned by the steering queue; and
- a batch returned by the follow-up queue.

All user messages in one drained batch receive the same ID. Assistant messages and tool results
causally produced before the next delivered batch inherit that ID. A tool-driven continuation must
retain the current ID. A retry also retains the current ID because it is part of the same user work.

The existing `turn_start` event counts model requests and must not become the logical-turn source of
truth. It may expose the active logical `turnId` as additional event metadata for extensions that
need live updates.

### 3. Publish typed extension data

Expose the active `turnId` on message and tool lifecycle events where it is known. This lets an
extension associate live TUI components without guessing from timestamps or content:

```ts
type AssistantMessageEvent = {
  message: AssistantMessage;
  turnId: number;
};

type ToolExecutionEvent = {
  toolCallId: string;
  turnId: number;
};
```

Keep the public names consistent with Pi's existing extension event types. A field is preferable to
a parallel telemetry event because event ordering then remains unchanged.

### 4. Derive metrics in core

Add a pure core module that reads the current branch's session entries, groups entries by `turnId`,
and derives `TurnMetric` snapshots. It must:

- preserve branch order rather than numeric ID order;
- include all assistant responses within one logical turn;
- count tool calls by unique tool-call ID;
- count failed results by matching tool-call ID;
- use the exact-first output-token calculation;
- never mutate entries; and
- tolerate malformed or incomplete entries.

Cache derived snapshots only in memory and invalidate on session append, branch navigation,
compaction, retry replacement, and session reload. The cache is an implementation detail, never a
persisted record.

### 5. Define old-session behavior

Old session entries lack `turnId`, so exact queue-batch reconstruction is unavailable. Keep those
sessions readable without rewriting them.

For a contiguous unmarked region, derive groups using the documented conservative rule: a user
message begins a group and following assistant/tool messages belong to it until the next user
message. Mark returned metrics `grouping: "inferred"`. New entries written by an updated Pi use
`grouping: "persisted"`.

Consumers that need exact grouping can omit inferred groups or render a small approximation marker.
Turn-fold should use the persisted result when available and retain its current conservative
behavior only for old unmarked history.

## Turn-fold adoption

After Pi exposes the API:

1. Replace extension-local historical grouping and queued-message reconstruction with
   `getBranchTurnMetrics()`.
2. Associate assistant and tool components using lifecycle `turnId` fields.
3. Render the newest three settled `TurnMetric` values and collapse older settled metrics into the
   existing history row.
4. Continue deriving no metrics in turn-fold. It becomes a TUI policy and rendering extension.
5. Remove duplicate token-estimation and durable group bookkeeping from turn-fold once Pi core owns
   it. Keep only formatting tests and a small adapter test suite.
6. Keep live-stats independent. It may use a future active-turn query for display consistency, but
   it must not become a dependency of turn-fold.

## Why consecutive user messages appear

Pi has queues for steering and follow-up input. Their mode can be `one-at-a-time` or `all`.

In `one-at-a-time` mode, Pi drains one queued message, completes its associated work, then drains
the next. In `all` mode, it drains all queued messages into the next agent-loop batch. The
transcript can therefore show several user messages in a row before an assistant message. They are
not missing assistant rows; they are multiple inputs delivered together.

Transcript compaction adds another source of confusion: Pi may replace old visible rows with a
summary. The active branch still contains the relevant context representation, but the TUI need not
render every prior assistant or tool message. A workflow can also submit user messages that do not
produce a user-visible assistant reply because the work is queued, redirected, or superseded.

The proposed `turnId` records the delivery relationship at the moment Pi knows it, so extensions do
not need to reverse-engineer either case later.

## Test plan

### Pi core

- Initial prompt, tool loop, retry, and final response share one `turnId`.
- `one-at-a-time` steering and follow-up messages receive distinct IDs.
- `all` steering and follow-up batches share one ID across every batch member.
- Consecutive queued user messages survive restart, compaction, export, and branch navigation with
  the same IDs.
- Branches retain inherited IDs and allocate noncolliding new IDs.
- Partial compaction prefixes preserve marked entries and produce valid metric snapshots.
- Malformed usage, content, IDs, and tool results do not throw.
- Old unmarked sessions return inferred groups without modifying JSONL.
- Event `turnId` values match their persisted session entries.

### Turn-fold

- A batch in `all` mode is rendered and counted as one logical turn.
- `one-at-a-time` queued messages render as separate turns.
- The newest three settled core metrics remain visible; older metrics collapse correctly.
- Tree navigation and compaction rebuild components from the current branch without stale groups.
- Exact and estimated output totals match the core snapshots.

## Rollout criteria

The core API is ready for extension adoption when:

- session-format fixtures cover marked and unmarked entries;
- extension lifecycle types expose the assigned ID;
- `getBranchTurnMetrics()` is stable, branch-aware, and fully tested;
- Pi's export and compaction paths preserve IDs; and
- turn-fold can delete its local queue/compaction grouping heuristics without losing a supported
  transcript case.
