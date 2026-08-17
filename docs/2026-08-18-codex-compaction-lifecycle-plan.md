---
title: Codex Compaction Lifecycle Plan
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-08-18
---

# Codex compaction lifecycle plan

## Goal

Native Codex compaction must not mark the active assistant turn as aborted or add a synthetic user
message to continue work. The extension must provide native compaction through Pi's documented
lifecycle and leave scheduling, retry, and continuation to Pi.

## Requirements

- Remove the proactive 90% controller that calls `ctx.abort()`.
- Remove `Compaction completed. Continue.` and all calls to `sendUserMessage`.
- Remove the `autoCompact` and `thresholdRatio` configuration contract because it no longer controls
  any behavior.
- Keep manual, threshold, and overflow native compaction through `session_before_compact`.
- Keep checkpoint replay, endpoint validation, credential safety, status rendering, and non-Codex
  pass-through behavior.
- Use only documented Pi extension APIs. Do not modify Pi core or private state.

## Scope

Change `@onurpi/pi-codex-compaction`, its tests, and its documentation. Update root or sibling
documentation only if it describes the removed behavior.

This work does not add frontier compaction to Pi. Until Pi exposes a safe turn-boundary compaction
barrier, Pi owns when compaction starts and whether an overflow retry continues the agent run.

## Implementation

1. Remove forced-compaction state and the `turn_end` and `agent_settled` handlers.
2. Remove the controller context methods that existed only for abort and continuation.
3. Delete the unused configuration module and tests.
4. Update extension registration tests and lifecycle tests to prove that no abort or synthetic
   continuation path remains.
5. Update the README and provenance notes to describe Pi-owned scheduling.

## Acceptance criteria

- A normal native compaction appends only Pi's compaction entry and optional TUI status entries.
- The extension never calls `ctx.abort()` or `pi.sendUserMessage()`.
- The extension does not register `turn_end` or `agent_settled` handlers.
- Manual, threshold, and overflow compaction still use the native Codex checkpoint.
- Non-Codex providers still pass through unchanged.
- Removed configuration fields are not accepted or documented through compatibility code.

## Verification

Run:

```sh
npm run check --workspace @onurpi/pi-codex-compaction
npm run slophammer --workspace @onurpi/pi-codex-compaction
npm run check
npm run slophammer
git diff --check
npx -y @simpledoc/simpledoc check docs/2026-08-18-codex-compaction-lifecycle-plan.md
```

Then load the package with Pi and verify that the extension registers the native compaction hooks
without `turn_end` or `agent_settled`.
