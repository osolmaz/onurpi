# IV-0002 — Bounded output lifecycle and compact tool rendering

**Status:** shipped in source (0.9.0)
**Root IV:** this document
**Related release:** [Changelog.md](../Changelog.md) — 2026-08-04 — 0.9.0
**Workspace doctrine:** [docs/DC-0001-agentic-workspace.md](./DC-0001-agentic-workspace.md)

## Intent

`kill_session` historically appended its entire retained final drain directly to
the tool result and had no custom Pi renderer. Pi therefore used its generic
fallback renderer, which ignored the collapsed/expanded state and printed the
whole payload. The same result bypassed unified-exec's normal 50 KiB / 2000-line
model-output cap and persisted an undocumented unbounded `final_output` field.

`list_sessions` also relied on the fallback renderer. Its inventory was smaller,
but the inconsistency meant the package's claim that tool output was compact and
expandable was not true for every tool.

The initiative establishes a durable three-layer output contract:

1. **Capture:** the child stream is mirrored to its session log.
2. **Model/session result:** every output-bearing result is a bounded,
   terminal-inert plain-text tail with explicit truncation/omission metadata and
   a recovery path.
3. **TUI:** the bounded result is collapsed to five visual lines by default and
   expands through Pi's configured `app.tools.expand` binding.

## Requirements

- Never depend on a TUI renderer to enforce model/session size limits. Pi falls
  back to raw result content if a renderer throws.
- Apply Pi's `DEFAULT_MAX_BYTES` / `DEFAULT_MAX_LINES` tail limits to
  `kill_session`, including model-visible recovery markers; independently cap
  metadata scans/headers that sit outside the output body.
- Keep the full retained stream out of result details; `details.output` is the
  canonical bounded body for exec, write, and kill.
- Strip ANSI/VT sequences and unsafe C0/C1 controls before child text reaches
  model content, persisted details, partial updates, or custom renderers. Keep
  exact raw bytes only in the session log and sanitize again while rendering
  legacy/fallback details.
- Represent operation and state explicitly (`operation`, `status`, `running`),
  rather than inferring liveness from the presence of `session_id`.
- Preserve failed-kill ownership: an unconfirmed kill remains registered and is
  reported as running.
- Give all five tools explicit call and result renderers.
- Count collapsed child output in visual lines after terminal wrapping.
- Use `keyHint("app.tools.expand", ...)`, not a hard-coded Ctrl+O label.
- Keep truncation and log-recovery warnings visible while collapsed.
- Do not synchronously load an arbitrary log file when expanded. Expanded mode
  shows the complete bounded result; `log_path` owns complete-stream recovery.

## Decisions

| Decision | Rationale |
|---|---|
| Split output serialization into `src/tool-result.ts` | Result bounds remain testable without process or TUI machinery, and `src/index.ts` no longer carries multiple ad-hoc serializers. |
| Replace undocumented `final_output` with bounded `output` | One canonical renderer/model field; avoids persisting up to the 1 MiB retained buffer. GitHub code search found no external consumer. |
| Version as 0.9.0 | The observable details shape changed even though the old field was undocumented. |
| Tool-specific render entry points over generic fallback | Kill/list semantics differ from process yields; explicit renderers prevent identity from being mistaken for liveness. |
| Expand only bounded output | Rendering or reading an unlimited multi-gigabyte log from a synchronous tool row is unsafe. |
| Make result text terminal-inert; preserve raw logs | PTY output can contain clipboard, alternate-screen, keyboard-mode, and cursor controls. Models need text, not executable terminal state; forensic bytes remain recoverable by path. |
| Keep complete logs for now | Archive bounding/retention is a separate policy change and remains follow-up work. |

## Implementation map

| Area | Location |
|---|---|
| Terminal-control scanner | `src/output-safety.ts` |
| Shared output envelope, truncation, process/kill text | `src/tool-result.ts` |
| Kill collection, partial sanitization, and tool registration | `src/index.ts` (`TerminateOutcome`, `buildStreamUpdate`, `kill_session`) |
| Explicit renderers and shared five-line preview | `src/render.ts` |
| Pure output and terminal-safety tests | `tests/{tool-result,output-safety}.test.ts` |
| Collapse/expand/list/legacy-safety renderer tests | `tests/render.test.ts` |
| Real delayed noisy-kill regression | `tests/e2e.test.ts` |
| Package/runtime compatibility | `package.json`, `package-lock.json`, `.github/workflows/ci.yml` |
| Public behavior and development guidance | `README.md`, `docs/DEV.md`, `Changelog.md` |

## Related upstream issues

These are design evidence rather than a direct tracker for this repository,
whose GitHub issues are intentionally disabled:

- [earendil-works/pi#31](https://github.com/earendil-works/pi/issues/31) —
  tool expansion through `app.tools.expand`.
- [#134](https://github.com/earendil-works/pi/issues/134) — bounded model
  output, visible warnings, and full-output recovery.
- [#275](https://github.com/earendil-works/pi/issues/275) — visual-line rather
  than logical-line previews.
- [#1795](https://github.com/earendil-works/pi/issues/1795) and
  [#5137](https://github.com/earendil-works/pi/issues/5137) — live TUI flooding
  and fallback/custom-tool output.
- [#6548](https://github.com/earendil-works/pi/issues/6548) — configured key
  hints in bounded previews.
- [#7578](https://github.com/earendil-works/pi/issues/7578) — exact failure
  class where a custom tool ignores the expanded flag.
- [#7237](https://github.com/earendil-works/pi/issues/7237) — related archive
  quota/failure concerns tracked below.

## Evidence and reproduction

Automated gate:

```bash
npm test
```

The focused process regression:

1. starts a command that yields before producing output;
2. emits 4000 long lines and then remains alive;
3. waits until the final line reaches the log;
4. calls `kill_session`;
5. asserts `details.output` is at most Pi's byte cap, the model text carries a
   truncation marker, no `final_output` exists, and the log contains line 1
   through line 4000.

Pure and renderer tests additionally exercise CSI/SGR mode changes, OSC
clipboard/title writes, terminal strings, C0/C1 controls, unterminated
sequences, legacy raw details, collapse, expand, re-collapse, expand-hint
placement, partial-preview cache refresh, unknown-id errors, and a seven-entry
session inventory with width-keyed row caching.

Manual TUI smoke procedure:

```text
exec_command: delayed noisy command that sleeps after output
kill_session: terminate its returned session id
observe: five visual tail lines + expansion hint + kill/log status
app.tools.expand: full bounded result
app.tools.expand again: five-line tail restored
```

## Consumers

- Pi model turns using `exec_command`, `write_stdin`, `kill_session`, or
  `list_sessions`.
- Humans reviewing streaming and settled tool rows in Pi's TUI; exact PTY logs
  must be opened through a non-executing reader/escape visualizer, not `cat`.
- Persisted Pi session entries containing tool result details.
- Private path-based adoption in `piagent-config`, whose lifecycle owner links
  this public initiative.

## Follow-up backlog

### Output archive safety

The current session log is complete but unbounded and relies on OS `/tmp`
cleanup. A separate initiative should decide and test:

- a configurable per-session archive cap with explicit unlimited opt-in;
- `log_status: complete | partial | unavailable`, bytes written, and bounded
  failure evidence;
- private (`0600`) exclusive creation with symlink/collision resistance and a
  documented trust boundary for `TMPDIR`;
- withholding the phrase “Full output” whenever archival degraded;
- prefix-scoped age/size cleanup; and
- quota, synchronous-open, asynchronous-write, close, and cleanup races.

Likely implementation location: a new `src/output-archive.ts` owned by
`ExecSession`.

### Renderer ticker ownership

The one-second elapsed/remaining ticker is cleared on a final result, but Pi's
component API has no universal disposal callback if an in-flight transcript is
dropped. Follow-up options are an extension-owned timer registry cleared on
`session_shutdown`, an upstream disposal contract, or accepting lower countdown
resolution without a dedicated ticker. Timers should at minimum be unreferenced
if this becomes observable as a host-liveness problem.

### Existing lifecycle work

Wake TTL/human disarm UX and Windows Job Object ownership remain in their
existing backlogs; they do not weaken this output contract.

## Non-goals

- No async full-log viewer in a tool row.
- No preservation of child ANSI styling in model/result/TUI text; the raw log
  is the recovery surface.
- No new model tool or output-size parameter.
- No change to process signaling, wake suppression, or kill escalation.
- No archive cap or deletion policy in 0.9.0.

## Retirement conditions

Before replacing this contract, prove the successor keeps model-visible output
bounded independently of rendering, keeps terminal state inert, preserves
complete/degraded recovery truthfully, honors Pi's configured expansion state,
and retains failed-process ownership. Remove this IV only after its tests and
consumers move with that replacement.
