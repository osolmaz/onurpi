# pi-tui-history-replay

`pi-tui-history-replay` is a vendored Pi extension for preserving visible transcript history. It renders the full active branch in chronological order after context compaction.

Pi continues to send its compacted context to the model. This package changes the interactive transcript only.

## Use

Install the local package, then reload Pi:

```bash
pi install ./packages/pi-tui-history-replay
```

```text
/reload
```

There is no command to enable the extension. It applies automatically in TUI sessions and keeps future compactions in chronological order. Long sessions take more time and memory to render because Pi creates components for the complete active branch.

## Provenance

This package was vendored from [`Molaison/pi-tui-history-replay`](https://github.com/Molaison/pi-tui-history-replay) at commit [`bb5b4389b23391428e810570d35e00924c19fc1b`](https://github.com/Molaison/pi-tui-history-replay/commit/bb5b4389b23391428e810570d35e00924c19fc1b). See [`UPSTREAM.md`](UPSTREAM.md) for the audit record and local changes.

The upstream repository had no license when this copy was made. This package remains private and must not be published without permission from the upstream author.
