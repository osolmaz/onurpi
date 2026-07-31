# Pi Reviewer

Pi Reviewer is a standalone code review CLI built with Pi Factory. It reviews a Git diff in a fresh Pi process and returns prioritized P0 through P3 findings in the same shape as standalone `codex review`.

## Install

The package is currently developed in the OnurPi workspace:

```bash
npm install
npm run build --workspace @osolmaz/pi-reviewer
npm link --workspace @osolmaz/pi-reviewer
```

## Configure a model

Pi Reviewer has no model identifier in its review extension. Set the default outside the extension:

```bash
pi-reviewer config set model openai-codex/gpt-5.6-terra
pi-reviewer config set thinking high
```

The optional user config lives at `~/.config/pi-reviewer/config.json`. A command-line model or thinking level overrides it for one run:

```bash
pi-reviewer --model openai-codex/gpt-5.6-sol --thinking high --base main
```

Authenticate the isolated Pi Reviewer profile once:

```bash
pi-reviewer login openai-codex
pi-reviewer models gpt-5.6
```

Credentials stay under Pi Reviewer's Pi Factory state. The command never copies credentials from another Pi profile.

## Review

```bash
pi-reviewer --uncommitted
pi-reviewer --base main
pi-reviewer --commit <sha>
pi-reviewer "focus on cancellation safety"
```

The command writes progress to stderr and the final report to stdout. A successful review returns zero even when it has findings. Invalid targets, authentication failures, model failures, malformed output, timeouts or cancellation return nonzero.

Normal reviews use `--no-session`, so they do not write Pi session history. Tools can inspect only the current checkout. Mutation, network clients, shell operators, external Git helpers, and paths outside the checkout are blocked.

## Codex compatibility

Pi Reviewer vendors Codex's review rubric and target prompt wording from commit `fa1d4c40d0e63eef2e0ba8a9e004ccd0a80b77f5`. [`UPSTREAM.md`](UPSTREAM.md) records the exact sources and local changes. [`CODEX-COMPARISON.md`](CODEX-COMPARISON.md) compares the commands and gives the same-branch verification procedure.

Both tools support reviews of uncommitted changes, base branches and commits, plus custom instructions. Both return findings with a title, body, confidence, priority, location, correctness verdict, and overall confidence. Pi Reviewer requires every finding to contain a P0 through P3 priority and fails closed on malformed output.

## Development

```bash
npm run check
npm run slophammer
```

Mutation testing is available through `npm run mutate` but is not part of normal completion checks.

## License

[MIT](LICENSE)
