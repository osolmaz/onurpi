# @onurpi/sticky-prompt

Keeps the prompt of the turn at the top of the transcript in view while the transcript scrolls.

The header row shows the last user prompt whose rows have all scrolled above the viewport, using

the user message background and text colors. No header is drawn while any part of a prompt is still
on screen, or while the next prompt is fewer than two blank rows below the top: the header and the
message padding share one background, so a closer header reads as one block with that prompt.

## How it works

The extension loads Pi's public TUI classes and patches two methods. It does not fork Pi and does
not need the extension API for rendering.

1. `ScrollView.prototype[Symbol.for("@earendil-works/pi-tui/layout-node")]` records which content
   component belongs to which scroll view, so a render can read the live scroll offset.
2. `Container.prototype.render` renders the transcript as usual, reads the child line ranges that Pi
   already records for mouse dispatch, picks the prompt above the first visible line, and replaces
   that one content line with the header. Height and scroll range stay the same, so nothing shifts.

`prompt-rows.ts` reads the spans, `header.ts` builds the row, and `patches.ts` installs and restores
the patches. `/reload` restores nothing by itself; `session_shutdown` restores both prototypes.

## Limits

- The header covers one transcript line while it is shown. It never adds a row, so the transcript
  keeps its full height.
- Only `UserMessageComponent` rows count as prompts. Skill invocations and other custom message
  components do not.
- Supported on Pi `>=1.5.0`. An older version leaves the transcript untouched.
- The row shows the prompt of the turn, not the turn number, and truncates to the terminal width
  with the user message colors.

## Development

```sh
npm run check --workspace=@onurpi/sticky-prompt
```
