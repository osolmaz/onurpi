# Upstream record

This package comes from [`Molaison/pi-tui-history-replay`](https://github.com/Molaison/pi-tui-history-replay). The pinned upstream commit is [`bb5b4389b23391428e810570d35e00924c19fc1b`](https://github.com/Molaison/pi-tui-history-replay/commit/bb5b4389b23391428e810570d35e00924c19fc1b).

The source was retrieved on 2026-07-19. The upstream repository contained `tui-history-replay.ts` and `README.md`, claimed compatibility with Pi 0.80.6, and had no license.

The source review found no process execution, network access, filesystem access, telemetry, credential access, tool overrides, or background resources. The extension changes one `SessionManager` instance method in TUI sessions. `buildSessionContext()` remains unchanged, so compacted messages stay out of model context.

The vendored package keeps the upstream runtime behavior. Local changes split the extension adapter from the patch logic, export the patch logic for tests, apply repository formatting, and add package metadata and quality checks.

Before updating this copy, review the new upstream diff against the pinned commit and repeat the security checks above. Record the new immutable commit here.
