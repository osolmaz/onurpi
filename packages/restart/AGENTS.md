# @onurpi/restart

- Keep the launcher as the stable foreground terminal process and Pi as its child.
- Never use a shell command, detached child, latest-session lookup, or session-file write.
- Do not call `ctx.shutdown()` until the launcher accepts the exact restart request.
- Keep the IPC protocol versioned, bounded, validated, and free of credentials and session content.
- Fail closed for direct Pi launches, ephemeral sessions, unsupported modes, ambiguous arguments,
  and unsupported platforms.
- Tests must use temporary state, call no model, and leave no child process.
- Before finishing, run `npm run check`, `npm run slophammer`, `git diff --check`, and a real Pi
  restart smoke test.
- Keep mutation testing manual unless the user explicitly requests it.
