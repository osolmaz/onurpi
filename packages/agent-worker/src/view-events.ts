import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ConversationView, EntryId, EntryRecord, LiveState } from "@earendil-works/pi-durable";

/**
 * One thing the worker learns from a revision of a conversation view.
 *
 * Pi Durable 1.5.0 removed `watchEvents()` and its event stream: a client renders the view instead
 * of assembling state from events. The worker still needs boundaries (a run starts and ends, a turn
 * closes, reasoning streams), so {@link ConversationViewBridge} derives them by diffing successive
 * revisions of `Conversation.watch()`. Every derivation here is a fact about the view, so a replayed
 * or coalesced revision cannot lose a boundary the worker acts on.
 */
export type ViewEvent =
  | { readonly type: "run_start" }
  | { readonly type: "run_end" }
  | { readonly type: "turn_end" }
  | { readonly type: "thinking_start" }
  | { readonly type: "thinking_delta"; readonly delta: string }
  | { readonly type: "text_delta" }
  | { readonly type: "message_end"; readonly entry: EntryRecord }
  | {
      readonly type: "tool_execution_start";
      readonly toolName: string;
      readonly args: Record<string, unknown>;
    }
  | { readonly type: "tool_execution_end"; readonly entry: EntryRecord | undefined };

type ToolCallInfo = { readonly name: string; readonly args: Record<string, unknown> };

/** A streamed assistant message, split into the parts the worker tracks. */
type StreamedParts = {
  readonly reasoning: string;
  readonly text: string;
  readonly calls: ReadonlyMap<string, ToolCallInfo>;
};

/** The built-in live document of a view. */
function liveOf(view: ConversationView): LiveState {
  return view.docs["pi.live"] ?? {};
}

/** The reasoning and answer text of a streamed assistant message, and the calls it makes. */
function partsOf(message: AssistantMessage | undefined): StreamedParts {
  const calls = new Map<string, ToolCallInfo>();
  let reasoning = "";
  let text = "";
  for (const part of message?.content ?? []) {
    if (part.type === "thinking") reasoning += part.thinking;
    else if (part.type === "text") text += part.text;
    else calls.set(part.id, { args: part.arguments, name: part.name });
  }
  return { calls, reasoning, text };
}

/** The calls the messages of one entry make, keyed by call ID. */
function callsOf(entry: EntryRecord, into: Map<string, ToolCallInfo>): void {
  for (const message of entry.model ?? []) {
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type === "toolCall") into.set(part.id, { args: part.arguments, name: part.name });
    }
  }
}

/**
 * Turns successive conversation views into the boundaries and stream deltas the worker acts on.
 *
 * One bridge per watch. It keeps the IDs and text lengths it has already reported, so each event is
 * produced once, whatever order or granularity the view revisions arrive in.
 */
export class ConversationViewBridge {
  private readonly seenEntries = new Set<EntryId>();
  private seenTools = new Set<string>();
  private running = false;
  private generation: { key: string; reasoning: number; answer: number } | undefined;
  private turnOpen = false;
  private readonly calls = new Map<string, ToolCallInfo>();

  /** The events one revision adds, in the order the worker should act on them. */
  diff(view: ConversationView): readonly ViewEvent[] {
    const live = liveOf(view);
    const streamed = partsOf(live.generation?.message);
    for (const [id, call] of streamed.calls) this.calls.set(id, call);
    const events: ViewEvent[] = [
      ...this.entryEvents(view.entries),
      ...this.toolEvents(live),
      ...this.streamEvents(live, streamed),
      ...this.runEvents(live),
    ];
    if (events.some((event) => event.type === "message_end")) this.turnOpen = true;
    if (events.some((event) => event.type === "turn_end")) this.turnOpen = false;
    return events;
  }

  /** New transcript entries: a turn closes before an answer, and a tool result ends its call. */
  private entryEvents(entries: readonly EntryRecord[]): readonly ViewEvent[] {
    const events: ViewEvent[] = [];
    for (const entry of entries) {
      if (this.seenEntries.has(entry.id)) continue;
      this.seenEntries.add(entry.id);
      callsOf(entry, this.calls);
      if (hasAssistantMessage(entry)) events.push({ type: "turn_end" });
      events.push({ entry, type: "message_end" });
      if (hasToolResult(entry)) events.push({ entry, type: "tool_execution_end" });
    }
    return events;
  }

  /** A tool call the view shows for the first time, labeled with the arguments it runs with. */
  private toolEvents(live: LiveState): readonly ViewEvent[] {
    const events: ViewEvent[] = [];
    for (const slot of live.tools ?? []) {
      if (this.seenTools.has(slot.callId)) continue;
      this.seenTools.add(slot.callId);
      const call = this.calls.get(slot.callId);
      events.push({
        args: call?.args ?? {},
        toolName: call?.name ?? slot.name,
        type: "tool_execution_start",
      });
    }
    return events;
  }

  /** Reasoning and answer text a generation added since the previous revision. */
  private streamEvents(live: LiveState, streamed: StreamedParts): readonly ViewEvent[] {
    if (live.generation === undefined) return [];
    const key = String(live.generation.attempt);
    if (this.generation?.key !== key) {
      this.generation = { answer: streamed.text.length, key, reasoning: streamed.reasoning.length };
      return [{ type: "thinking_start" }];
    }
    return [...this.reasoningChange(streamed.reasoning), ...this.answerChange(streamed.text)];
  }

  /** Run boundaries: the live document's run appears while the agent works and goes when it ends. */
  private runEvents(live: LiveState): readonly ViewEvent[] {
    const events: ViewEvent[] = [];
    if (live.run !== undefined && !this.running) {
      this.running = true;
      events.push({ type: "run_start" });
    }
    if (live.run === undefined && this.running) {
      this.running = false;
      if (this.turnOpen) events.push({ type: "turn_end" });
      events.push({ type: "run_end" });
      this.seenTools = new Set();
    }
    return events;
  }

  /** The reasoning text a generation added since the previous revision. */
  private reasoningChange(reasoning: string): readonly ViewEvent[] {
    const generation = this.generation;
    if (generation === undefined || reasoning.length <= generation.reasoning) return [];
    const delta = reasoning.slice(generation.reasoning);
    generation.reasoning = reasoning.length;
    return [{ delta, type: "thinking_delta" }];
  }

  /** The first answer text a generation shows, reported once as a plain delta. */
  private answerChange(text: string): readonly ViewEvent[] {
    const generation = this.generation;
    if (generation === undefined || text.length <= generation.answer) return [];
    generation.answer = text.length;
    return [{ type: "text_delta" }];
  }
}

function hasAssistantMessage(entry: EntryRecord): boolean {
  return (entry.model ?? []).some((message) => message.role === "assistant");
}

function hasToolResult(entry: EntryRecord): boolean {
  return (entry.model ?? []).some((message) => message.role === "toolResult");
}
