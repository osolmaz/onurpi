---
name: manage-repos
description: Use when creating, onboarding, auditing, or tightening GitHub repositories, including repository descriptions, release-published package workflows, github-sane-defaults, and stricter branch rulesets that require human review before merges to the default branch.
---

# Manage Repos

## Core Rule

Apply `github-sane-defaults` to every GitHub repository you create or manage:

```sh
npx -y github-sane-defaults@latest apply OWNER/REPO
```

For an entire organization:

```sh
npx -y github-sane-defaults@latest apply OWNER --all
```

Use `plan` first when auditing or when the user has not explicitly approved changes:

```sh
npx -y github-sane-defaults@latest plan OWNER/REPO
```

## New Open Source Software Repositories

When creating a new repository that is intended to publish open source software:

- Set a concise GitHub repository description that says what the software does.
  Use `gh repo edit OWNER/REPO --description "..."` and keep it specific enough
  to distinguish the repository in GitHub lists.
- Use the `add-license` skill to add the appropriate license. Default to MIT
  unless the user or repository requirements specify another license.
- Use the `write-readme` skill for the README. Keep it user-focused: what the
  software does, how to install it, how to use it, and what users need to know.
- Keep maintainer process details, local machine paths, private usernames,
  credentials, scratch notes, and history of how the repo was created out of the
  README.

## Package Publish Workflows

When adding or revising package publish workflows for a repository:

- Use the `semver` skill to choose the version when a release bump is part of the
  task.
- Default new publish workflows to `on: release: types: [published]`, not
  `on: push: tags`.
- Create new package versions by publishing a GitHub Release. A tag can identify
  the released commit, but a bare tag push should not be the normal release
  action or the sole publish trigger unless the repository explicitly requires
  tag-push releases.
- Validate the release tag against package metadata before publishing. Also
  check that the tagged commit is on the default branch, the version is not
  already published, and build artifacts come from the tagged commit.
- For trusted publishing setups such as PyPI or npm provenance, wire the
  workflow environment and permissions to the release-published job, then verify
  the registry after the GitHub Release publishes.
- If an older tag-triggered workflow already published a version, do not delete,
  recreate, yank, or republish that immutable version just to replay it through a
  GitHub Release. Update the workflow for the next version.

## Slophammer

When creating or onboarding a project in a language supported by Slophammer,
apply Slophammer standards too. The point is not a one-off local scan; add the
checker/config/CI so the repository keeps enforcing the standard.

Supported checker selection:

- Go: `slophammer-go`
- TypeScript: `slophammer-ts`
- Rust: `slophammer-rs`
- Python: `slophammer-py`

Start from the Slophammer agent entrypoint:

```text
https://github.com/osolmaz/slophammer/blob/main/docs/AGENT_ENTRYPOINT.md
```

Typical new-repo tasks:

- add `AGENTS.md` with the commands agents must run before finishing
- add `slophammer.yml`
- add or update CI so the selected Slophammer checker runs
- pin the checker version in CI
- run the selected checker locally and report whether it passed

Do not claim Slophammer passed if the language-specific checker is unavailable.
In that case, apply the documented standards manually and say what could not be
run.

## Strict Merge Review

Some repositories need a stricter rule: an agent may have write access, but must
not be able to merge to the default branch just because it wants to. For those
repositories, create an additional branch ruleset that:

- targets `~DEFAULT_BRANCH`
- requires one approving pull request review
- allows bypass only for the human admin role that owns the repository:
  organization admins for organization repositories, or repository admins for
  personal repositories
- does not grant bypass to write, maintain, or agent accounts

This strict rule complements `github-sane-defaults`; it does not replace it.

Bypass actor choice:

- Organization repository: `{ actor_id: null, actor_type: "OrganizationAdmin",
  bypass_mode: "always" }`
- Personal repository: `{ actor_id: 5, actor_type: "RepositoryRole",
  bypass_mode: "always" }`

`RepositoryRole` actor id `5` is GitHub's repository admin role. Use it for
personal repositories where the human owner should be able to bypass the rule,
but write-role agent accounts should not.

Example `gh` command:

```sh
OWNER="example-org"
REPO="example-repo"
RULESET_NAME="strict: require review before default-branch merge"
BYPASS_ACTORS_JSON='[
  { "actor_id": null, "actor_type": "OrganizationAdmin", "bypass_mode": "always" }
]'
payload_file="$(mktemp)"

jq -n --arg name "$RULESET_NAME" --argjson bypass_actors "$BYPASS_ACTORS_JSON" '{
  name: $name,
  target: "branch",
  enforcement: "active",
  bypass_actors: $bypass_actors,
  conditions: {
    ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] }
  },
  rules: [
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: false,
        required_reviewers: [],
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
        allowed_merge_methods: ["merge", "squash", "rebase"]
      }
    }
  ]
}' >"$payload_file"

ruleset_id="$(
  gh api "repos/$OWNER/$REPO/rulesets" --jq \
    ".[] | select(.name == \"$RULESET_NAME\") | .id" | head -n 1
)"

if [ -n "$ruleset_id" ]; then
  gh api -X PUT "repos/$OWNER/$REPO/rulesets/$ruleset_id" \
    --input "$payload_file"
else
  gh api -X POST "repos/$OWNER/$REPO/rulesets" \
    --input "$payload_file"
fi

rm -f "$payload_file"
```

## Workflow

1. Identify the target repository or organization using `gh repo view` or the
   user-provided target.
2. Run `github-sane-defaults plan` unless the user already asked to apply.
3. Run `github-sane-defaults apply` for every target repository.
4. For new open source software repositories, set a concise GitHub repository
   description, add a license with `add-license`, and write the README with
   `write-readme`.
5. If the repository needs package publishing, configure publish workflows to
   publish from GitHub Releases rather than bare tag pushes.
6. For supported languages, add Slophammer configuration and CI.
7. For strict repositories, create or update the separate review-required
   ruleset with the correct human-admin-only bypass actor for the repository
   owner type.
8. Verify repository metadata with `gh repo view OWNER/REPO --json description`.
9. Verify GitHub rulesets with:

```sh
gh api "repos/OWNER/REPO/rulesets" --jq '.[] | {name, target, enforcement}'
```

For the strict ruleset, fetch the full payload and confirm `pull_request`
requires one approval. For organization repositories, `bypass_actors` should
contain only `OrganizationAdmin`. For personal repositories, `bypass_actors`
should contain only `RepositoryRole` actor id `5`.

## Safety

- Do not put personal names, private usernames, credentials, or local machine paths
  into reusable skill docs, ruleset names, or example commands.
- Do not weaken an existing stricter rule unless the user explicitly asks.
- Do not give bypass to agent accounts, write-role actors, or maintain-role
  actors.
- For organization repositories, do not give bypass to broad repository-admin
  roles; use organization admins unless the user explicitly asks for a different
  model.
- For personal repositories, use repository-admin bypass when the human owner
  should retain override ability.
