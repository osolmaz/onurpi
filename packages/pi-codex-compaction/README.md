# pi-codex-compaction

> [!WARNING]
> This extension is under active development. Its behavior and configuration may change.

OpenAI Codex native remote compaction integrated into Pi's existing compaction lifecycle.

## Why automatic compaction is enabled by default

Pi's automatic threshold is too late for uninterrupted tool loops. Pi normally checks for compaction after the agent run settles, so repeated assistant → tool → provider turns can pass the configured context limit without giving compaction a chance to run. One observed run reached 361k tokens—132.7% of a 272k limit—with 189 additional tool-use responses and no compaction entry. Requests above 272k enter Codex's long-context pricing tier, which doubles input and cache-read cost and raises output cost by 50%. The extension therefore enables its own 90% turn-boundary threshold by default.

## Why compaction uses Pi's lifecycle

The published extension previously compacted only the provider payload and stored the checkpoint as a custom session entry. OpenAI received shorter context, but Pi had no real compaction boundary and kept processing and rendering the full transcript. In large live sessions this drove Pi to roughly 95–135% CPU; creating a real Pi compaction boundary reduced it to roughly 6–10%. This version stores the native checkpoint in Pi's compaction entry so Pi stops rebuilding and rendering the old transcript too.

## How it works

When the active model uses `openai-codex/openai-codex-responses`, the extension intercepts Pi's manual, threshold, and overflow compaction events. It sends the finalized Responses history to the normal Codex endpoint with a trailing `compaction_trigger`, stores the returned opaque `compaction` item inside Pi's real compaction entry, and lets Pi rebuild the active transcript from that boundary.

During a tool-driven run, the extension checks Pi's reported context usage after each completed turn. At 90%, it aborts before the next provider request. Once the agent settles, it invokes Pi's normal compaction lifecycle. After successful compaction it sends a visible user continuation message. If Pi's own threshold or overflow compaction runs first, the extension uses that result instead of compacting twice.

Pi requires compaction events to store a summary string, so they receive a short local checkpoint marker. The marker is filtered from provider context and is never sent to OpenAI. Overflow recovery remains owned by Pi.

In interactive mode, each native compaction adds `OpenAI compaction running…` and completion or failure markers to the chat transcript. These durable TUI entries are never included in model context.

## Install

```bash
pi install npm:@ogulcancelik/pi-codex-compaction
```

## Behavior

Native compaction activates only for `openai-codex`. Other providers never receive the opaque checkpoint or the local marker; after a provider switch they can see only Pi messages that remain outside the native checkpoint. The extension performs no text-summary model call.

Native checkpoints are persisted in `CompactionEntry.details`. Resume, forks, tree navigation, and repeated compaction derive state from the newest checkpoint on the active branch. The request advertises Codex's `remote_compaction_v2` feature on compaction and follow-up calls.

Compaction is fail-closed. If a native request fails, Pi's compaction is cancelled and the previous history remains intact. The extension never silently falls back to Pi text summarization. If a persisted native checkpoint is malformed or belongs to another Codex model, the next request is aborted rather than sending Pi's local marker to OpenAI.

## Configuration

Mid-run compaction is enabled at 90% by default:

```json
{
  "autoCompact": true,
  "thresholdRatio": 0.9
}
```

Save this as `~/.pi/agent/pi-codex-compaction.json` or project-local `.pi/pi-codex-compaction.json`. Project configuration takes precedence. `thresholdRatio` must be greater than 0 and less than 1. Pi's `compaction.reserveTokens` setting still controls Pi's own threshold compaction.

## Data handling

The current conversation is sent to the ChatGPT Codex Responses endpoint. OpenAI returns an opaque `encrypted_content` value, which is stored in the local Pi session JSONL and replayed to OpenAI on compatible subsequent requests.

## Limitations

Native checkpoints are model-specific. Switch back to the model that created the checkpoint before continuing. Provider switching is not a portability path because no textual summary is generated.

Pi does not expose a finalized provider payload during `session_before_compact`. The extension mirrors Pi's Codex message conversion and combines it with the latest observed request shape to construct the compaction request. Extensions loaded later that independently rewrite provider payloads can therefore create order-dependent behavior.

Mid-run compaction uses `ctx.abort()` because Pi does not yet expose a supported way for extensions to stop cleanly between tool turns. The abort happens only after `turn_end`, when tool results are finalized, but it remains a temporary compatibility path until Pi supports turn-boundary compaction directly.
