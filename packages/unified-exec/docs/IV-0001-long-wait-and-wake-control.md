# IV-0001 — Long-wait UX, wake control, and agent guidance

**Status:** shipped (0.7.1) + post-review hardening (0.7.2)  
**Root IV:** this document  
**Related release:** [Changelog.md](../Changelog.md) — 2026-07-22 — 0.7.1 / 0.7.2  
**Workspace doctrine:** [docs/DC-0001-agentic-workspace.md](./DC-0001-agentic-workspace.md)

## Intent

After shipping absolute waits (`yield_until`) and completion wakes
(`on_exit: "wake"`) in 0.7.0, operators and agents hit four practical problems:

1. **Human readability** — while attached to a UTC deadline, the TUI only
   showed a raw ISO timestamp; humans need remaining time like `2h40m later`.
2. **Cache thrash** — agents used `yield_until` to bypass the 290 s empty-poll
   cap too often, defeating prompt-cache friendliness.
3. **Wake overuse** — default was already `"none"`, but tool guidance still
   promoted `"wake"`; most jobs do not need auto-resume.
4. **Stale wakes** — once armed, a late/failed background job could resume the
   agent unexpectedly, and the model had **no way to disarm** without killing
   the process.

Also: the **10 h `yield_until` horizon** was an artificial reject; multi-day
attached waits should work (with safe `setTimeout` chunking).

## Non-goals

- Wake TTL / auto-expire (optional later).
- Changing the `on_exit` enum values or default away from `"none"`.
- Soft-disable of `triggerTurn` on wake delivery.
- Making `yield_until` the default long-poll path.

## Decisions

| Decision | Rationale |
|---|---|
| Humanize remaining time in TUI only; keep ISO in tool details | Model still needs machine-parseable deadlines via `tool_time_utc` / `yield_until`. |
| Guide `yield_until` as **human-explicit only** | Prevents routine 290 s bypass and cache misses. |
| Guide `on_exit: "wake"` as **human-explicit only** | Default stays `"none"`; reduces stale resumes. |
| Add `set_on_exit` tool (disarm/re-arm without kill) | Model must be able to undo a mistaken wake while leaving the process running. |
| Remove default 10 h horizon entirely (option A) | No silent clamp; no env cap; any valid RFC 3339 UTC future is accepted. |
| Chunk timers at `MAX_TIMER_ARM_MS` (`2^31-1`) | Prevents `setTimeout` overflow on multi-day waits. |
| Mid-flight flush re-checks suppression | Disarm racing a reserved wake must not still send. |

## Implementation map

| Area | Location | Notes |
|---|---|---|
| Remaining / elapsed labels | `src/format-time.ts` | `formatRemainingLater`, `formatElapsed`, etc. Remaining re-exported from `time.ts`. |
| TUI call/footer | `src/render.ts` | Banner + streaming status use remaining label; 1 s invalidate re-runs call+result. |
| Horizon removal | `src/time.ts` | `parseYieldUntil(raw, nowMs)` — no max arg. Dropped env/constants. |
| Long timer arms | `src/long-wait.ts` | `MAX_TIMER_ARM_MS`; re-arm loop. |
| Policy change | `src/completion.ts` → `setOnExit(id, policy, session?)` | By-id disarm (tombstones); status tokens; flushPending deliver filter. |
| Wake audit | `list_sessions` / widget / slash picker | `wake_armed` / `[wake]`. |
| Tool surface | `src/index.ts` | `set_on_exit` tool + renderer; rewritten `promptGuidelines`. |
| Docs | `README.md`, `Changelog.md`, this IV, `DC-0001` | Rules + API tables + workspace doctrine. |
| Tests | `tests/time.test.ts`, `long-wait.test.ts`, `completion.test.ts`, `wake-e2e.test.ts`, `e2e.test.ts` | Unit + pipeline; wake-e2e `afterEach` shutdown. |

## Agent / human guidance (shipped copy intent)

```text
yield_time_ms ≤ 290s     → default progress polls (repeat OK, cache-friendly)
yield_until              → ONLY if human explicitly asks for long attach / UTC deadline
on_exit default          → "none"
on_exit "wake"           → ONLY if human explicitly wants auto-resume
mistaken / abandoned wake → set_on_exit(session_id, on_exit: "none")  # does not kill
kill_session             → kill process AND suppress wake
list_sessions            → includes wake_armed for audit
```

Disarm cannot recall a follow-up already queued via `pi.sendMessage`.

## Evidence

### Probe: can the model cancel wake without kill?

**Procedure** (extension harness, no full LLM turn required):

```bash
# Conceptual cases exercised in tests/wake-e2e.test.ts and ad-hoc probe:
# A kill_before_exit          → 0 wakes
# B unobserved fail exit      → 1 wake
# C write_stdin observes exit → 0 wakes (consumed)
# D list_sessions race        → unreliable (debounce window)
# E short poll while running  → still armed; later exit wakes
# set_on_exit none + fail exit → 0 wakes   (new)
```

**Observed (pre-fix):** no disarm API; only `kill_session` or observing the
exit reliably suppressed wake. `list_sessions` after exit is a race against the
~250 ms debounce.

**Observed (post-fix):**

```bash
npx tsx --test tests/time.test.ts tests/long-wait.test.ts tests/completion.test.ts
# 53 pass

npx tsx --test tests/wake-e2e.test.ts
# 26+ pass — set_on_exit disarm/re-arm, unknown sid, list wake_armed, …

npx tsx --test tests/e2e.test.ts
# 42 pass, 2 skip

npx tsx --test tests/*.test.ts
# 250+ pass, a few skip; occasional flaky notify sleep timing under load (unrelated)
```

### Related pre-fix diagnosis

Stale wake is **not** “default is wake”. Default is `"none"`. The footgun is:
guidance over-promotes wake + no undo path + `triggerTurn: true` on late exit.

## Consumers

- Pi agents loading this extension (`exec_command` / `write_stdin` / new
  `set_on_exit`).
- Humans watching TUI remaining labels during absolute waits.
- Any skill/prompt that previously told models to use `yield_until` freely or
  arm wake “just in case” — should be aligned with human-explicit rules.

## Open / later

- Optional wake TTL if stale resumes remain common even with guidance + disarm.
- Human slash-command action for `set_on_exit` (picker currently kill-only;
  wake is now visible as `[wake]`).
- Soften `triggerTurn` for very old completions (product choice).
- liveTicker cleanup if TUI drops a streaming component mid-wait (P3).

## Revision notes

- **Opened + shipped in one pass (0.7.1):** UI remaining, guidance, horizon
  removal, `set_on_exit`, tests, docs. IV written after implementation to
  preserve intent and evidence for the workspace.
- **0.7.2 (fable-5 review top 5):** wake_armed visibility; tombstone disarm by
  id; format-time unify; dead `policy` field removed; set_on_exit renderer;
  wake-e2e afterEach cleanup + waitFor debounce waits. Rejected frozen-banner
  and in-flight-send “bugs” as incorrect / by-design.
