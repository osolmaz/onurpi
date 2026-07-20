# Nyan Mode

Nyan Mode adds an animated bitmap Nyan Cat context runway to Pi's footer. The cat moves from left to right as the active model context fills and returns toward the left after compaction or a new session. The footer retains Pi's cumulative API cost and subscription indicator.

```text
empty context ─────────────────────────────── full context
0%                                                     100%
```

The extension uses the original Emacs Nyan Mode artwork and the Kitty graphics protocol. It works in terminals that Pi detects as Kitty-image capable, including compatible Kitty, Ghostty, and WezTerm configurations. Pi normally disables image protocols inside `tmux` and `screen` because passthrough is unreliable.

## Commands

```text
/nyan          Toggle Nyan Mode
/nyan on       Enable bitmap rendering
/nyan off      Disable bitmap rendering
/nyan bitmap   Enable bitmap rendering
/nyan debug    Show image protocol, asset, and painter status
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
