# Conventional Commits 1.0.0 excerpts

Source: <https://www.conventionalcommits.org/en/v1.0.0/>
License: CC BY 3.0

The excerpts below are copied from the official specification so the skill can rely on the canonical wording when needed.

## Summary excerpt

> The Conventional Commits specification is a lightweight convention on top of commit messages.

> The commit message should be structured as follows:

```text
<type>[optional scope]: <description>

[optional body]
[optional footer(s)]
```

## Relevant specification excerpt

> Commits MUST be prefixed with a type, which consists of a noun, `feat`, `fix`, etc., followed by the OPTIONAL scope, OPTIONAL `!`, and REQUIRED terminal colon and space.

> A scope MAY be provided after a type. A scope MUST consist of a noun describing a section of the codebase surrounded by parenthesis, e.g., `fix(parser):`

> A description MUST immediately follow the colon and space after the type/scope prefix. The description is a short summary of the code changes.

> Breaking changes MUST be indicated in the type/scope prefix of a commit, or as an entry in the footer.

> Types other than `feat` and `fix` MAY be used in your commit messages, e.g., `docs: update ref docs`.

## Common type definitions

> `fix`: a commit of the type `fix` patches a bug in your codebase.

> `feat`: a commit of the type `feat` introduces a new feature to the codebase.

## How this skill applies the spec

Conventional Commits is the official spec for commit messages, not for pull requests. This skill applies the first line of that spec to PR titles because that is the common practice used by semantic PR title checks and squash-merge workflows.
