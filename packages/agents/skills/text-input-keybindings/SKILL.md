---
name: text-input-keybindings
description: Use when implementing, reviewing, or designing any text input surface, including TUI composers and editor widgets, REPL or shell prompts, chat input boxes, and single-line form fields. Provides the readline/Emacs keybindings users expect by muscle memory, tiered by how strongly they are expected, plus terminal key-equivalence caveats and conflict guidance for submit/cancel chords.
---

# Text Input Keybindings

Users bring shell and macOS muscle memory to every text box. These bindings
come from GNU Readline's Emacs mode; shells, REPLs, and Cocoa text fields all
honor them. A text input that ignores them feels broken even when arrow keys
work. Implement tier 1 in anything beyond a trivial field, tier 2 in anything
called an editor or composer, and treat tier 3 as optional polish.

## Tier 1 — table stakes (missing these gets noticed immediately)

| Chord | Action |
| --- | --- |
| `Ctrl+A` | move to beginning of line |
| `Ctrl+E` | move to end of line |
| `Ctrl+W` | delete the word before the cursor (whitespace-delimited) |
| `Ctrl+K` | kill from cursor to end of line |
| `Ctrl+U` | kill from cursor to beginning of line (whole line in shells) |
| `Backspace` / `Ctrl+H` | delete char before cursor (same byte — see caveats) |

## Tier 2 — expected in editors, composers, and REPLs

| Chord | Action |
| --- | --- |
| `Ctrl+F` / `Ctrl+B` | forward / back one character (synonyms for arrows) |
| `Ctrl+P` / `Ctrl+N` | previous / next line (synonyms for up/down; multiline only) |
| `Alt+F` / `Alt+B` | forward / back one word |
| `Alt+Backspace` | delete word before cursor (letter/digit boundaries, unlike `Ctrl+W`) |
| `Alt+D` | delete word after cursor |
| `Ctrl+D` | delete char under cursor (inside an editor; EOF only at an empty shell prompt) |
| `Ctrl+Y` | yank back the last text killed by `Ctrl+K`/`Ctrl+U`/`Ctrl+W`/`Alt+D` |

`Ctrl+Y` requires at least a single-slot kill buffer shared by all kill
operations. Implement it together with the kill chords; a `Ctrl+K` that
cannot be undone by `Ctrl+Y` surprises heavy users.

## Tier 3 — power-user extras (nice, rarely missed)

| Chord | Action |
| --- | --- |
| `Ctrl+T` | transpose the two characters around the cursor |
| `Alt+T` | transpose words |
| `Ctrl+_` | undo |
| `Alt+<` / `Alt+>` | beginning / end of buffer |

## Terminal caveats

- `Ctrl+H` ≡ `Backspace`, `Ctrl+I` ≡ `Tab`, `Ctrl+M` ≡ `Enter`,
  `Ctrl+[` ≡ `Esc`: the terminal sends the same byte, so these cannot be
  bound separately and need no separate handling.
- `Ctrl+S`/`Ctrl+Q` are XOFF/XON flow control in cooked mode. Raw-mode TUIs
  receive them fine; line-mode programs may never see them.
- Alt chords arrive as ESC-prefixed sequences; crossterm and similar
  libraries surface them as an ALT modifier. If the input deliberately
  ignores Alt-modified characters (a good default against accidental
  input), carve explicit exceptions for the Alt bindings above.
- `Ctrl+Enter` is indistinguishable from `Enter` in many terminals; never
  make it the only path to an action.

## Conflict guidance

- Submit and cancel chords own their keys: a composer using `Ctrl+S`
  (submit) and `Ctrl+C` (cancel) conflicts with nothing above. Do not use
  `Ctrl+D` for submit inside an editor; users read it as delete-forward.
- `Ctrl+A` as select-all is a GUI convention; in terminal inputs it means
  beginning-of-line. Follow the platform the input lives in.
- When a chord must be dropped for a product reason, prefer dropping from
  tier 3 upward, and keep synonyms (arrows for `Ctrl+F`/`Ctrl+B`) so the
  capability remains reachable.

## Review checklist

1. Tier 1 fully present? Any absence is a finding.
2. Kill chords paired with `Ctrl+Y`?
3. `Ctrl+W` vs `Alt+Backspace` word boundaries distinguished (whitespace vs
   letter/digit)?
4. Modified keys that are NOT bound do nothing, rather than inserting the
   raw character or triggering unrelated actions?
5. Multiline inputs: `Ctrl+P`/`Ctrl+N` move by visual row through wrapped
   lines, matching the arrow keys.
