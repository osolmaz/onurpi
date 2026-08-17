---
name: extending-pi
description: Use alongside pi-coding-agent whenever proposing, designing, implementing, reviewing, or debugging a change to Pi behavior through extensions or packages, especially when deciding between a public extension API and Pi core, or when the request asks for an elegant, long-term, production-ready, ideal, or holy-grail Pi solution. Enforces an extension-first boundary unless the user explicitly asks to modify Pi itself.
---

# Extending Pi

Use this skill together with `pi-coding-agent`. The installed Pi documentation
and examples remain authoritative.

## Hard Boundary

A request to change Pi behavior is a request to extend Pi, not to modify Pi
itself, unless the user explicitly asks for a Pi source or core change.

Words such as "root cause," "proper fix," "elegant," "long-term,"
"production-ready," "ideal," and "holy grail" do not authorize changes to Pi
source, private APIs, internal classes, undocumented behavior, or persistent Pi
schemas.

Do not propose a Pi fork, upstream core patch, monkey patch, prototype patch,
or private-API integration when a documented extension or package can provide
the requested behavior. A bug in Pi is not permission to change Pi.

## Required Workflow

Before proposing or implementing a solution:

1. Load and follow the `pi-coding-agent` skill.
2. Resolve the installed Pi package root from the active `pi` executable.
3. Read `docs/extensions.md` and `examples/extensions/README.md` completely.
4. Read every relevant linked document and example completely. For example,
   read `docs/compaction.md` and `examples/extensions/custom-compaction.ts` for
   compaction work, or `docs/tui.md` for TUI behavior.
5. Inventory the documented public hooks, context objects, commands, tools,
   renderers, provider APIs, and package mechanisms that apply.
6. Classify the public API before designing:
   - **Sufficient:** implement an extension or Pi package.
   - **Sufficient with a limitation:** implement the supported behavior and
     state the limitation plainly.
   - **Insufficient:** stop at the limitation and ask before considering
     persistence, private APIs, or Pi source changes.

Do not skip this workflow for architecture discussions. Proposals are subject
to the same boundary as implementations.

## Extension-First Design

Prefer, in order:

1. Existing settings or documented commands.
2. A documented extension hook or API.
3. An independent Pi package containing the extension and its tests.
4. A documented custom provider or SDK integration when the behavior belongs
   at that boundary.

For OnurPi, keep the implementation independent under `packages/<name>/` with
a package manifest, entry point, tests, and README, and register its development
entry point in the root Pi manifest.

Use public event return values instead of mutating Pi-owned state directly. For
example, customize compaction through `session_before_compact`; do not append or
rewrite compaction entries manually.

If a public hook can prevent a failure, prefer intercepting at that hook over
observing the failure afterward. Do not invent a failure hook or persistence
mechanism that Pi does not document.

## Proposal Contract

Every Pi extension proposal must include a short contract-impact statement:

- **Session state:** say whether normal Pi behavior will append or change any
  session entry.
- **Other persistent data:** default to none.
- **Pi internals:** default to none.
- **Public API:** name the documented hooks or methods used.

If any answer exceeds the default boundary, obtain explicit user authorization
before proceeding.

## Long-Term And Ideal Solutions

Keep ideal solutions inside the extension boundary unless the user explicitly
removes that constraint. The most ambitious acceptable design may combine
multiple public hooks, ephemeral in-memory policy, documented provider APIs,
and an independent package; it must not silently become a Pi redesign.

When the public API cannot express the full ideal, separate:

- the best production extension that can be built now, and
- the exact capability Pi would need to expose publicly.

Describe the missing public capability without proposing or implementing an
internal patch.

## Verification

For behavior changes:

1. Add tests for hook selection, pass-through behavior, success, failure, and
   duplicate prevention where relevant.
2. Run the package and repository quality checks.
3. Exercise the extension with `pi -e` or a temporary package path.
4. Restart or reload Pi and verify discovery from the intended scope.
5. Confirm that no undocumented state, schema, or Pi internal was changed.
