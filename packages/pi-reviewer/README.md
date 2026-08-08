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

Pi Reviewer uses regular Pi's canonical `auth.json` directly:

```bash
pi-reviewer models gpt-5.6
pi-reviewer login openai-codex
```

Reviewer config records `auth: "pi"`. Model settings, prompts, tools, and session policy remain isolated. Login and OAuth refreshes update regular Pi's canonical auth file without copying credentials.

Hugging Face Inference Providers models work through regular Pi's Hugging Face OAuth from `pi-huggingface-oauth`, including route-suffixed model identifiers discovered by regular Pi. The reviewer registers the same OAuth provider in its isolated runtime and reads regular Pi's model catalog cache in place.

```bash
pi-reviewer config set model huggingface/moonshotai/Kimi-K3:fireworks-ai
pi-reviewer config set thinking high
```

If the canonical auth file has no Hugging Face credential yet, run `pi-reviewer login huggingface` or regular Pi's Hugging Face login once. Both write the same canonical credential through regular Pi's auth file. Token refreshes stay shared through that file, so the reviewer never holds its own copy.

For a model that is not yet in Pi's catalog, pass a strict model manifest. The selected provider and model must match the manifest. `apiKeyEnv` names an environment variable; the manifest does not contain the credential.

```json
{
  "version": 1,
  "provider": {
    "id": "example",
    "baseUrl": "https://api.example.com/v1",
    "apiKeyEnv": "EXAMPLE_API_KEY",
    "compat": { "supportsDeveloperRole": false }
  },
  "model": {
    "id": "organization/model:route",
    "name": "Model via pinned route",
    "reasoning": true,
    "input": ["text"],
    "contextWindow": 131072,
    "maxTokens": 32768,
    "cost": { "input": 0.1, "output": 0.2, "cacheRead": 0, "cacheWrite": 0 }
  }
}
```

```bash
pi-reviewer --model example/organization/model:route \
  --model-manifest ./model.json --base main
```

## Review

```bash
pi-reviewer --uncommitted
pi-reviewer --base main
pi-reviewer --commit <sha>
pi-reviewer "focus on cancellation safety"
```

The command writes progress to stderr and the final report to stdout. Use `--format json` to emit the validated Codex-compatible result object without terminal prose:

```bash
pi-reviewer --base main --format json > review.json
```

Use `--metrics-file` to record cumulative token use, estimated cost from the pinned model prices, and the provider, requested model, and response model reported by Pi. The file is refreshed after each model response, including during a review that later fails.

```bash
pi-reviewer --base main --format json --metrics-file ./review-metrics.json > review.json
```

A successful review returns zero even when it has findings. Invalid targets, authentication failures, model failures, malformed output, timeouts or cancellation return nonzero.

Normal reviews use an in-memory Pi SDK session and do not write Pi session history. Review execution stays in a bounded child worker that is separate from the CLI process. Tools can inspect only the current checkout. Mutation, network clients, shell operators, external Git helpers, and paths outside the checkout are blocked.

## Codex compatibility

Pi Reviewer vendors Codex's review rubric and target prompt wording from commit `fa1d4c40d0e63eef2e0ba8a9e004ccd0a80b77f5`. [`UPSTREAM.md`](UPSTREAM.md) records the exact sources and local changes. [`CODEX-COMPARISON.md`](CODEX-COMPARISON.md) compares the commands and gives the same-branch verification procedure. [`CASE-STUDY.md`](CASE-STUDY.md) records a paired comparison on two historical snapshots with known defects.

Both tools support custom instructions and the same review targets. A target can cover uncommitted changes or compare against either a base branch or one commit. Both return findings with a title, body, confidence, priority, location, correctness verdict, and overall confidence. Pi Reviewer requires every finding to contain a P0 through P3 priority and fails closed on malformed output.

## Development

```bash
npm run check
npm run slophammer
```

Mutation testing is available through `npm run mutate` but is not part of normal completion checks.

## License

[MIT](LICENSE)
