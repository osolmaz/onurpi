# Nyan Mode

Nyan Mode adds a Nyan Cat context runway to Pi's footer. Text mode is the default: a bold animated kaomoji follows a smooth, full-height rainbow that starts full and drains as usable model context is consumed. Compaction or a new session fills it again. Bitmap mode remains available for Kitty-compatible terminals. The footer retains Pi's cumulative API cost and subscription indicator, while its numeric percentage remains Pi's context-used value.

```text
full usable context ─────────────────── exhausted context
100% available                                   0% available
```

Nyan places the namespaced Codex weekly-remaining status after `(sub)` in the main number group. That value disappears when a non-Codex model is active. Other extension status text remains on the line below the runway. The extension uses the original Emacs Nyan Mode artwork and the Kitty graphics protocol. It works in compatible Kitty, Ghostty, and WezTerm configurations. Auto mode verifies Kitty support with an end-to-end terminal query instead of trusting environment variables alone. Terminals and transports that do not answer, including Mosh, receive a normally colored ANSI kaomoji with an elongating true-color rainbow instead. `/nyan bitmap` and `/nyan text` remain available as explicit overrides.

## Cat moods

The text cat stays neutral while Pi is idle and moves continuously while Pi is streaming. Its session-local state machine chooses among dancing, thinking, focused, pleased, unimpressed, annoyed, and angry poses:

- active tool calls make it focus;
- successful tool results briefly make it pleased;
- recent or repeated tool errors escalate from annoyed to angry;
- longer runs progress through thinking, focusing, unimpressed, annoyed, and eventually angry moods.

Error history lasts only for the current Pi session. The extension does not persist telemetry or mood state. `/nyan debug` reports the current mood and session error count.

## Commands

```text
/nyan          Toggle Nyan Mode
/nyan on       Enable the selected rendering mode (text by default)
/nyan off      Disable Nyan Mode
/nyan auto     Prefer bitmap and fall back to text
/nyan bitmap   Force bitmap rendering
/nyan text     Force ANSI kaomoji rendering
/nyan debug    Show mode, image protocol, asset, and painter status
```

When bitmap rendering is unavailable or the footer is too narrow, the footer remains usable without the runway.

## Development

From the repository root:

```bash
npm --workspace @onurpi/nyan-mode run check
npm --workspace @onurpi/nyan-mode run slophammer
pi -e ./packages/nyan-mode/index.ts
```

Optional manual mutation testing remains available with
`npm --workspace @onurpi/nyan-mode run mutate`.

See [UPSTREAM.md](UPSTREAM.md) for provenance, the security review, and local changes.

## License

[GPL-3.0-or-later](LICENSE). The bundled artwork comes from [TeMPOraL/nyan-mode](https://github.com/TeMPOraL/nyan-mode); see [NOTICE](NOTICE) and [assets/nyan-mode/LICENSE](assets/nyan-mode/LICENSE).
