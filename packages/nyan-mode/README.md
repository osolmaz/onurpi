# Nyan Mode

Nyan Mode adds a Nyan Cat context runway to Pi's footer. Text mode is the default: a kaomoji moves from left to right as the active model context fills and returns after compaction or a new session. Bitmap mode remains available for Kitty-compatible terminals. The footer retains Pi's cumulative API cost and subscription indicator.

```text
empty context ─────────────────────────────── full context
0%                                                     100%
```

The extension uses the original Emacs Nyan Mode artwork and the Kitty graphics protocol. It works in compatible Kitty, Ghostty, and WezTerm configurations. Auto mode verifies Kitty support with an end-to-end terminal query instead of trusting environment variables alone. Terminals and transports that do not answer, including Mosh, receive a normally colored ANSI kaomoji with an elongating rainbow trail instead. The kaomoji alternates dance poses while Pi is streaming. `/nyan bitmap` and `/nyan text` remain available as explicit overrides.

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
