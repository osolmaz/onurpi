# Pi Must Win

Pi Must Win is an umbrella branding extension for the Pi coding agent. It gives work performed
through Pi a consistent identity in the places where other coding harnesses already leave
attribution.

The first feature adds these trailers when Pi's agent creates a Git commit through the `bash` tool:

```text
Co-Authored-By: <model name> <noreply@pi.dev>
Generated-By: pi <version>
```

The extension uses a session-scoped `prepare-commit-msg` hook. It supports ordinary commits, message
files, nested shell commands, absolute Git paths, and amended commits. Existing repository hooks
still run, and no hook or `core.hooksPath` setting is left in the repository.

Commits entered manually through `!git commit` or a separate terminal are unchanged.

## Install

From the OnurPi checkout, run:

```bash
pi install ./packages/pi-must-win
```

Run `/reload` in an existing Pi session. Future branding features will be added under the same
package.
