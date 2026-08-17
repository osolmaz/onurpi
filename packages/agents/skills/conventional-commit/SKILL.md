---
name: conventional-commit
description: Use when the user asks to draft, rewrite, validate, or standardize a commit message or pull request title using Conventional Commits, semantic PR title rules, or conventional commit wording.
---

Use this skill when a commit message or pull request title should follow Conventional Commits.

There is no separate official "Conventional PR" specification. The official document is Conventional Commits 1.0.0 for commit messages. When working on pull requests, this skill applies that one-line header format to PR titles, which is common practice and is often enforced by semantic PR title checks.

If you need the canonical wording, read [references/conventional-commits-v1.0.0.md](references/conventional-commits-v1.0.0.md). That file contains attributed excerpts from the official specification.

## Workflow

1. Check repo-local guidance first. Search `AGENTS.md`, `README*`, `CONTRIBUTING*`, `.github/pull_request_template*`, workflow files, and title or commit lint configuration.
2. If repo-local rules conflict with this skill, follow the repo-local rules.
3. Otherwise, format the commit message or PR title as a Conventional Commit header:
   - `<type>[optional scope]: <description>`
4. Prefer the smallest correct type:
   - `feat` for new functionality
   - `fix` for bug fixes
   - `docs`, `chore`, `refactor`, `test`, `perf`, `ci`, or `build` only when they fit better than `feat` or `fix`
5. Use a scope only when it adds real clarity. Keep it noun-like and codebase-specific.
6. Write the description in imperative mood, keep it specific, and do not end it with a period.
7. Use `!` only for breaking changes.
8. If the repo squash-merges PRs or otherwise uses the PR title as the final merge commit title, make the title fully compliant with Conventional Commits.
9. If the task is a PR, follow the repo template for the PR body if one exists. If not, keep it short and structured with sections such as `Summary`, `Testing`, and `Risks`.
10. When reviewing or rewriting an existing commit message or PR title, explain the mismatch precisely and provide one to three corrected options.

## Default Body

```md
## Summary
- Describe the behavior change

## Testing
- List the exact validation commands

## Risks
- Note rollout or follow-up concerns
```

## Examples

- `feat(auth): add SSO login`
- `fix(api): handle empty payload`
- `docs: clarify sync workflow`
- `chore(ci): enforce semantic PR titles`
