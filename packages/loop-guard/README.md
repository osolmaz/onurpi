# @onurpi/loop-guard

Opt-in bounded loop detection for the Pi coding agent.

Loop Guard watches streamed reasoning and finalized agent turns after you enable it. It uses deterministic, bounded fingerprints and action features. It does not call another model, inspect the filesystem, use the network, or scan the complete session transcript.

## Commands

```text
/loop-guard on
/loop-guard off
/loop-guard status
/loop-guard reset
/loop-guard nudge
```

The extension starts off after every load, reload, or session replacement. `/loop-guard on` starts a fresh in-memory detection epoch. A substantive user instruction also starts a fresh epoch. Short continuation prompts remain in the current epoch.

## Detection

Loop Guard intervenes after one of these bounded conditions:

- Three separate 96-token reasoning windows each appear three times while one assistant response is streaming.
- An exact outcome cycle of length one through four repeats three times.
- The same terminal error occurs three times.
- Four continuation-led episodes have at least 85% adjacent action similarity.
- Eight settled episodes finish in one epoch.
- One agent run reaches twelve turns.

Streamed reasoning matching ignores case, punctuation, and whitespace differences. Fuzzy action similarity never triggers by itself.

## Intervention policy

The first detection sends one visible `onurpi-loop-guard` message. It tells the model to stop the current approach, restate verified facts, identify invalidated work, and choose a materially different action. A streamed-reasoning detection aborts the looping provider response immediately, then starts one corrective follow-up after Pi settles. Other active-run detections are delivered as steering.

A second detection in the same epoch trips the guard. It does not send another model message. If the agent is active, Loop Guard aborts it and waits for substantive user direction or `/loop-guard reset`.

Loop Guard emits `onurpi:loop-guard` events with versioned `nudge` and `trip` actions so other extensions can pause their own continuation policy. OnurPi's bundled Goal extension listens for these events and pauses an active goal before it can queue another automatic run.

## State and performance

Disabled handlers return before collecting detector state. Enabled episode state is bounded to twelve digests, sixteen turns per episode, thirty-two tool actions per episode, and 256 hashed action features. Streamed reasoning state keeps one 96-token rolling window and at most 2,048 content-selected hashes. Raw model, reasoning, and tool content is not retained.

The package persists no settings or detector state. The visible intervention message is the only session entry it adds.

## Development

```bash
npm run check
npm run slophammer
```

Mutation testing remains manual:

```bash
npm run mutate
```
