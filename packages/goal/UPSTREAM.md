# Upstream provenance

| Field                    | Value                                      |
| ------------------------ | ------------------------------------------ |
| Repository               | https://github.com/Michaelliv/pi-goal      |
| Commit                   | `3f100be5434454d3388755a119d01caca9127c16` |
| Retrieved                | 2026-07-29                                 |
| Upstream package version | `0.1.7`                                    |
| License                  | MIT                                        |

## Reviewed contents

The review covered the package manifest, lockfile, README, MIT license, release workflow, every source file under `.pi/extensions/pi-goal/`, the `pi-goal-writer` skill, all tests, and the poster source and asset.

The extension executes no processes, installs no shell hooks, reads no files at runtime, accesses no credentials, sends no telemetry or network requests, intercepts no provider traffic, overrides no built-in tools, handles no project-trust decisions, and starts no background process. It registers three tools, one command, one message renderer, a status line, lifecycle hooks, custom session state, and custom model-visible messages.

## Local changes

- Renamed the private package to `@onurpi/goal` and converted imports to OnurPi's `@earendil-works` Pi packages. The package now uses ESM with strict TypeScript and TypeBox schemas. OnurPi adds Vitest coverage and Slophammer. Mutation tests remain manual.
- Kept the upstream `pi-goal` and `pi-goal-event` custom types, command names, tool names, completion-only `update_goal` contract, branch-aware state, reload pause, optional user-requested token budget, and `pi-goal-writer` skill.
- Moved continuation scheduling from `agent_end` to `agent_settled` so retries and compaction finish before Goal starts another run. Queued work also finishes first.
- Added pauses for interruption and terminal errors. Repeated cycles and the automatic-run checkpoint also pause the goal. The compact safety state stores hashes and excludes raw model or tool content.
- Reduced state writes to one accounting snapshot per settled goal run. Repeated continuation messages stay short because `before_agent_start` injects the active objective and audit guidance.
- Added strict state reconstruction, lifecycle integration tests, replay tests, and long-session regression coverage.
- Omitted the upstream release workflow, package lockfile, CommonJS tests, README poster, and poster source because OnurPi owns packaging, quality gates, and documentation.
