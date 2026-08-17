---
name: semver
description: Use this while deciding how to choose the next version during release, including whether a change should bump major, minor, patch, or a pre-1.0 project version.
---

# SemVer Release Versioning

Use this skill when choosing the next release version, reviewing a release bump, or explaining whether a change should be major, minor, or patch.

Do not blindly map commit labels to releases. `feat:` often maps to a minor bump in release automation, but SemVer itself is about the declared public API and the compatibility promise a project makes to users.

## Official Anchor

Source: Semantic Versioning 2.0.0 at https://semver.org/. Short quoted phrases below are from that spec, licensed CC BY 3.0.

Verbatim anchors to preserve:

- "MUST declare a public API"
- "Major version zero (0.y.z)"
- "MUST NOT be modified"
- "SHOULD NOT be considered stable"

Practical reading:

- A SemVer project needs a clear public API. For a library, that is usually exported APIs. For a CLI, include commands, flags, config files, output formats, exit codes, protocols, and documented behavior that users can script against.
- After 1.0.0, bump major for incompatible public API changes, minor for compatible public API additions or deprecations, and patch for compatible bug fixes.
- For 0.y.z, SemVer says the public API is not stable. That does not mean every new feature must be a minor bump. Follow the repo's own pre-1.0 convention and previous releases.
- Once a package or artifact is published, do not rewrite that exact version. Correct mistakes with a new release. If the package registry supports yanking, use it only to guide new installs away from a bad version, not to pretend the version never existed.

## Version Selection Workflow

1. Find the release policy first.
   Check `README*`, `CONTRIBUTING*`, `CHANGELOG*`, release docs, package metadata, release scripts, workflows, and recent tags/releases.
2. Identify the public API for this repo.
   For apps and CLIs, treat user-visible invocation, config, persistence format, IPC, environment variables, and documented output as the compatibility surface.
3. Compare the pending changes against that surface.
   Decide whether existing users can keep using the software in the same supported way.
4. Choose the smallest version bump that communicates the real compatibility change.
   Prefer the repo's explicit convention over generic commit-to-version mappings.
5. State the reason in one sentence before changing files.
   Example: `Patch because this only fixes incorrect CLI behavior and does not add a new supported command or output contract.`

## Bump Rules For 1.0.0 And Later

- Major: existing documented or relied-on behavior breaks, a public API is removed, command syntax becomes incompatible, config/data formats require migration, or dependency constraints force incompatible user action.
- Minor: new backward-compatible public functionality, new command/flag/API, new supported config field, new output mode, or a deprecation users need to see before a later removal.
- Patch: backward-compatible bug fix, documentation-only change, tests, internal refactor, packaging fix, performance improvement that preserves public behavior, or dependency update that does not add public functionality.

## Bump Rules Before 1.0.0

If the repo has no explicit rule, use this conservative default:

- Patch: fixes, docs, tests, refactors, release metadata, small compatible behavior improvements, and small CLI/app UX improvements that users would not plan an integration around.
- Minor: substantial new capability, new command family, new persistent file/config/API surface, new automation surface, or a behavior addition users may intentionally depend on.
- Major: only if the project already uses pre-1.0 major bumps or is intentionally declaring a reset in compatibility expectations.

When a user asks for a patch bump on a pre-1.0 app, do not override that just because a commit is typed `feat:`. Explain the tradeoff only if it matters.

## Release Bump Procedure

1. Confirm the current version from package manifests, lockfiles, tags, and releases.
2. Decide the next version using the workflow above.
3. Update all version sources that the project treats as authoritative.
   Examples: `Cargo.toml`, `Cargo.lock`, `package.json`, generated lockfiles, docs, install snippets, and changelogs.
4. Use package-manager commands where they reduce mistakes, but inspect the resulting diff.
5. Run the repo's release-relevant checks before release.
   Prefer local CI scripts, tests, package verification, install smoke tests, and release dry-runs where available.
6. Commit with a Conventional Commit release title if the repo uses that style.
   Example: `chore: release 1.2.3`.
7. Wait for required CI on the release commit before publishing the GitHub Release unless the repo explicitly allows releasing first.
8. Create or publish the GitHub Release for the version.
   The release may create or point at the repo's conventional tag, commonly `vX.Y.Z`, while the SemVer value itself is `X.Y.Z`.
9. Put release notes on the GitHub Release before or during publication.
   Keep patch notes narrow, minor notes focused on new capabilities, and major notes explicit about migration.
10. Verify the publish workflow or registry state after release.

## Publish Workflow Setup

- When adding a new publish workflow, default to `on: release: types: [published]`, not `on: push: tags`.
- New package versions should be created by publishing a GitHub Release. A tag can identify the released commit, but a bare tag push should not be the normal release action or the sole publish trigger unless the repo explicitly requires tag-push releases.
- In the workflow, validate that the release tag matches the package metadata version before publishing. Also check that the tagged commit is on the default branch, the version is not already published, and the build artifacts come from the tagged commit.
- For trusted publishing setups such as PyPI or npm provenance, wire the workflow environment and permissions to the release-published job, then verify the registry after the GitHub Release publishes.
- If a version was already published through an old tag-triggered workflow, do not delete, recreate, yank, or republish that same immutable version just to replay it through a GitHub Release. Update the workflow for the next version and explain the history if users may be confused.

## If The Wrong Version Was Published

- Do not delete and recreate a published version unless the registry and repo policy explicitly allow it and no users can have consumed it.
- Prefer publishing the corrected next version.
- If the registry supports yanking, consider yanking the mistaken version so dependency resolution avoids it.
- Explain the correction plainly in release notes or follow-up communication when users could be affected.

## Output Pattern

When asked what to bump, answer in this shape:

```md
Recommended bump: patch/minor/major to X.Y.Z.

Reason: one sentence tied to the public API and repo policy.

Checks before release:
- exact command or workflow
- exact command or workflow
```
