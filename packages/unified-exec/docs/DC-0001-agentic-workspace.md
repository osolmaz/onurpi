# DC-0001 — IV/DC Agentic Workspace

**Status:** active doctrine  
**Scope:** this repository’s Markdown cognitive workspace for humans and LLM
coding agents.

## Purpose

Markdown documents are a cognitive workspace. The system preserves intent,
guides attention, enables progressive disclosure, records reproducible
evidence, and supports safe feature retirement.

It is intentionally not a formal database or deterministic dependency system.
Use reasoning, repository search, verification, and human judgment.

## Document dimensions

### IV — Initiative

An IV is the lifecycle entry point for a user need, campaign, issue, or major
system change. It records the relevant requirements, external knowledge,
important facts, assumptions, decisions, non-goals, implementation locations,
known consumers, evidence, and reproduction methods.

The IV explains why related repository artifacts exist.

When an IV grows beyond one coherent working context, split cognitively local
parts into child documents. Keep a summary and annotated link in the parent.
Every child must link back to its root IV.

Split by semantic and domain locality, not merely by file length. Merge files
when they are almost always read or changed together.

### DC — Doctrine

A DC records horizontal engineering doctrine that may influence many
initiatives: conventions, reasoning principles, verification loops, recurring
constraints, and lessons learned.

Doctrines guide intelligent judgment. They are not a deterministic policy
engine.

## Links

Links are attention routes and lifecycle clues, not formally typed pointers.

Use links to show:

- where detailed context lives;
- where implementation lives;
- which initiatives consume shared behavior;
- which evidence or reproduction method applies;
- what replaced or superseded something.

Prefer annotated links that explain when the target should be read.

## Evidence

Record important evidence near the relevant claim:

- the observed result;
- the command or procedure that reproduces it;
- any environment assumptions needed to rerun it.

Results may become stale. Rerun the reproduction method when current truth
matters. Preserve the reproduction path more carefully than the old result.

## Time

Use logical time only. Clearly mark or remove information that is retired,
superseded, moved, or stale. Use revision notes only for semantically important
transitions; Git provides detailed history.

## Agent workflow

Before changing the repository:

1. Locate and read the relevant root IV.
2. Follow only the child links relevant to the task.
3. Read applicable DCs.
4. Inspect linked code and search for additional dependencies or consumers.
5. Confirm the intended outcome and non-goals.

While changing the repository:

1. Keep IVs, child documents, code, and evidence consistent.
2. Return to the root IV to prevent interpretation drift.
3. Update reproduction methods when verification procedures change.
4. Preserve cognitive locality when splitting, moving, or merging documents.

When retiring an initiative:

1. Start from the root IV.
2. Follow its links through documents, code, tests, configuration,
   infrastructure, data, APIs, jobs, dashboards, and other artifacts.
3. Search the repository for unlinked consumers and dynamic dependencies.
4. Identify behavior still required by other initiatives.
5. Delete only what no longer has lifecycle justification.
6. Run the strongest practical verification loops.
7. Mark, move, or delete the retired IV and remove stale links.

## Core principle

Markdown is the repository’s durable memory and attention map.
The agent supplies interpretation and intelligence.
IVs organize reality vertically by intent and lifecycle.
DCs organize behavior horizontally by doctrine.
Progressive disclosure keeps each working context cognitively coherent.

## Naming

| Kind | Path pattern | Example |
|---|---|---|
| Initiative | `docs/IV-NNNN-<slug>.md` | `docs/IV-0001-long-wait-and-wake-control.md` |
| Doctrine | `docs/DC-NNNN-<slug>.md` | `docs/DC-0001-agentic-workspace.md` |

Number sequentially. Prefer stable slugs; rename only when the semantic center
moves.
