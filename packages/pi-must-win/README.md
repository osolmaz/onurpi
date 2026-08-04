# Pi Must Win

This private OnurPi package loads a pinned Pi Must Win commit and connects its generic
child-environment attribution API to Unified Exec's pre-spawn event.

Pi Must Win remains responsible for Git trailers and hook handling. Unified Exec remains responsible
for command execution. This package contains the integration between them.

OnurPi loads this wrapper from the local checkout. It is not published to npm. Run `/reload` after
changing the package or global settings.

## Disabling per repository

The wrapper skips the whole extension for repositories listed in a global config file at
`$XDG_CONFIG_HOME/pi-must-win/config.json` (default `~/.config/pi-must-win/config.json`):

```json
{ "disabledRepos": ["github.com/openclaw", "~/experiments/junk"] }
```

Entries are remote-URL keys or absolute local paths:

- URL entries accept any remote syntax (`git@github.com:owner/repo.git`, `https://...`, `ssh://...`)
  and normalize to a lowercase `host/path` key. An entry matches exactly or as a path-segment
  prefix, so `github.com/openclaw` disables the whole org while `github.com/open` does not match
  `github.com/openclaw`.
- Path entries (starting with `/` or `~`) match the main clone path exactly.

Matching keys on repository identity, not the working directory: the wrapper resolves
`git remote get-url origin` and `git rev-parse --path-format=absolute --git-common-dir` at load
time, so every linked worktree of a disabled repo is covered without committing configuration into
the repository. A missing or malformed config file disables nothing.

The decision is made once when the extension loads. A session that starts in an allowed repo and
later commits inside a disabled one still gets trailers. A disabled repo skips the GitHub star
prompt for that session as well; the prompt fires on its own cadence in other sessions.
