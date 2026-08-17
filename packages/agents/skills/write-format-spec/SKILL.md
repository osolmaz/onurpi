---
name: write-format-spec
description: Use when writing, reviewing, or rewriting a specification for a portable file, folder, resource, package, manifest, profile, schema, or other structured format. Helps produce clear, author-friendly specs with concrete examples, field rules, validation behavior, extension points, runtime loading semantics, and boundaries.
---

# Format Specification Writing Guide

This guide describes how to write a clear specification for a portable file,
folder, resource, or package format.

It is meant for specs that need to be read by both people and implementers:
authors who create files by hand, tool builders who validate them, and runtimes
that load them.

## The Main Principle

Start with the thing the user creates.

If the format is a folder, show the folder tree first. If the format is one
file, show the file first. If the format is a resource object, show the
smallest valid resource first.

Do not begin with abstract goals, ecosystem motivation, or implementation
theory. Those can come later. The reader should understand the shape of a valid
artifact within the first minute.

## What A Good Format Spec Does

A good format spec answers these questions in order:

1. What do I create on disk or send to the system?
2. What is the smallest valid example?
3. Which fields are required?
4. Which fields are optional?
5. What are the exact validation rules?
6. How do references to other files or resources work?
7. When does the runtime load, resolve, and validate the format?
8. How can I check that my artifact is valid?

The spec should help a reader move from zero to a valid artifact quickly.

## Reader Model

Write for three readers at the same time.

### Authors

Authors want to know what to write.

They need:

- a minimal example
- field descriptions
- valid and invalid examples
- common mistakes
- a validation command

### Implementers

Implementers want to know what to parse and reject.

They need:

- exact required fields
- type constraints
- naming rules
- path resolution rules
- merge or inheritance rules
- error conditions

### Operators

Operators want to know what the runtime will do.

They need:

- loading order
- trust boundaries
- whether remote fetches happen
- whether files are read during a request
- how versioning works
- what is logged or surfaced for diagnostics

Do not write three separate specs unless the format is already large. Write one
spec whose sections are easy for each reader to find.

## Recommended Structure

Use this order for most small format specs:

1. Format overview
2. Directory or file structure
3. Minimal valid example
4. Main file or resource format
5. Field summary table
6. Field-by-field details
7. Optional folders or supporting files
8. File references
9. Inheritance, layering, or composition
10. Runtime loading and resolution
11. Validation
12. Extension points
13. What the format does not cover

This order puts concrete authoring first and runtime details later.

## Opening Section

The opening should be short.

Good opening:

```text
This specification defines the folder format for portable runtime profiles.
A profile pack is a directory with one required `profile.yaml` file and any
files referenced by that profile.
```

Weak opening:

```text
This specification aims to establish a robust and extensible abstraction for
cross-platform runtime behavior configuration across heterogeneous systems.
```

The first version tells the reader what exists. The second makes the reader
wait for the actual format.

## Directory Or File Structure

If the format has an on-disk shape, show it early.

Use a tree like this:

```text
resource-name/
├── profile.yaml      # Required entry point
├── prompts/          # Optional referenced files
│   └── system.md
├── assets/           # Optional static files
└── README.md         # Optional human documentation
```

Then explain only what matters:

- which file is required
- which folders are optional
- whether extra files are allowed
- where references are resolved from
- whether files may escape the folder root

Keep the first tree small. A giant tree makes the format look harder than it
is.

## Required Entry Point

A portable format should have one obvious entry point.

Examples:

- `profile.yaml`
- `manifest.json`
- `package.yaml`
- `config.toml`

Avoid requiring several files for the minimum valid artifact. Multiple required
files make validation, copying, and review harder.

If more files are useful, make them referenced files. The main file should tell
the reader and runtime where to find them.

## Minimal Valid Example

Put a minimal valid example near the top.

The example should be small enough to copy:

```yaml
apiVersion: example.io/v1
kind: ExampleResource
metadata:
  name: basic
spec:
  mode: default
```

Do not show every optional field in the first example. Save the full example
for later.

The minimal example is a promise: this is all you need to start.

## Full Example

After the field details, include a fuller example.

Use the full example to show how optional parts fit together:

```yaml
apiVersion: example.io/v1
kind: ExampleResource
metadata:
  namespace: example
  name: advanced
spec:
  mode: tuned
  prompt:
    file:
      path: ./prompts/system.md
      digest: sha256:...
  example.io:
    localMode: compact
```

The full example should still be realistic. Do not include fake fields just to
show extensibility.

## Object Model

Define the object model in plain language before showing types.

Example:

```text
A pack is a directory.
The directory contains one required manifest file.
The manifest contains one resource.
The resource has metadata for identity and spec for behavior.
Referenced files must stay inside the pack.
The runtime consumes a resolved snapshot, not the raw files.
```

This gives readers a mental model before they see a schema.

## Field Summary Table

Use a table for the main fields.

Good table columns:

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `apiVersion` | Yes | string | Format API version. |
| `kind` | Yes | string | Resource type. |
| `metadata` | Yes | object | Resource identity. |
| `spec` | Yes | object | Desired behavior or content. |

Use a table when each row has the same kind of information. Do not use tables
for long explanations.

## Field Detail Sections

After the summary table, give each important field its own section.

Use the same pattern each time:

1. Say what the field does.
2. State whether it is required.
3. List exact constraints.
4. Show a valid example.
5. Show invalid examples when mistakes are likely.
6. Explain runtime meaning if it affects behavior.

Example:

````markdown
### `metadata.name`

`metadata.name` identifies the resource inside its namespace.

Rules:

- 1 to 64 characters
- lowercase letters, numbers, and hyphens
- must not start or end with a hyphen
- must match the folder name when the resource is loaded from a pack

Valid:

```yaml
metadata:
  name: qwen3-6b
````

Invalid:

```yaml
metadata:
  name: Qwen3-6B
```
```

The repeated structure helps readers scan and helps implementers build tests.

## Naming Rules

Be exact about names.

Names often become:

- file paths
- registry ids
- resource selectors
- URLs
- cache keys
- diagnostic labels

Loose naming rules create compatibility problems later.

A good naming section should define:

- allowed characters
- length limits
- case sensitivity
- whether names may start or end with separators
- whether consecutive separators are allowed
- whether the name must match a folder or file name
- whether names are globally unique or namespace-scoped

Show valid and invalid examples.

## Required Versus Optional Fields

Keep the required set small.

A field should be required only when the format cannot be safely understood
without it.

Good required fields:

- resource type
- format version
- identity
- the one payload field the artifact exists to define

Poor required fields:

- diagnostics
- display metadata
- comments
- registry-only metadata
- optional runtime tuning

Small minimum formats are easier to author, test, and migrate.

## Optional Fields

Optional fields should have a clear job.

When documenting an optional field, explain:

- when to include it
- what happens when it is omitted
- whether omission means default behavior or unknown behavior
- whether the runtime may ignore it

Example:

```text
`digest` is optional. When it is present, the loader must verify the referenced
file content. When it is omitted, the loader still validates the path but does
not pin the file content.
```

Avoid optional fields that exist only because they might be useful someday.

## Defaults

Document defaults close to the field.

Bad:

```text
The default behavior is described in the runtime section below.
```

Better:

```text
If `mode` is omitted, the runtime uses its normal mode.
```

Say whether a default is:

- a schema default inserted during validation
- a runtime fallback used when the field is absent
- a UI default used only when creating a new file

Those are different behaviors.

## Values And Enums

Do not create global enum values unless the values are truly portable.

If a value belongs to one implementation, put it in that implementation's
section.

Good:

```yaml
spec:
  common:
    level: high
  example.io:
    toolProfile: lean
```

Weak:

```yaml
spec:
  common:
    toolProfile: lean-v1
```

The weak version makes a local behavior look like a cross-ecosystem standard.

When defining enum values, describe each value in a table:

| Value | Meaning |
| --- | --- |
| `off` | Disable the behavior. |
| `low` | Use a low setting. |
| `high` | Use a high setting. |

Do not hide important behavior behind names like `standard`, `default`, or
`optimized` unless the spec defines exactly what they mean.

## Domain-Named Sections

For cross-project formats, use a small common section and project-owned
sections.

Example:

```yaml
spec:
  common:
    prompt:
      file:
        path: ./prompts/system.md
  example.io:
    toolProfile: lean
```

The common section should contain fields that other implementations can
reasonably share.

Project-owned sections should contain behavior that belongs to one
implementation, provider, or product.

Document the rule plainly:

```text
Fields under `spec.common` are portable. Domain-named sections are owned by the
project that controls that domain. Implementations must ignore domain sections
they do not understand unless their policy says otherwise.
```

## Extension Points

Extension points need boundaries.

Good extension points:

- domain-named sections
- `metadata` for non-runtime annotations
- optional referenced files
- experimental fields clearly marked as experimental

Risky extension points:

- arbitrary `extra` maps
- provider request fragments
- executable hooks
- open-ended merge behavior
- runtime-specific values in common fields

If you add an extension point, explain what it is for and what it must not
contain.

## File References

File references need exact rules.

A file reference section should answer:

- Are paths relative to the manifest file or the pack root?
- Are absolute paths allowed?
- Can paths escape the pack root?
- Are symlinks allowed?
- Are missing files an error?
- Are digests supported?
- When are files read?
- Are files read again during runtime requests?

Example wording:

```text
Referenced file paths are relative to the manifest file. Paths must stay inside
the pack root. Absolute paths and `..` escapes are invalid. The loader resolves
and validates files before runtime use.
```

This avoids many future security and portability issues.

## Digests

If a referenced file can include a digest, define it exactly.

Say:

- which hash algorithm is used
- whether the algorithm is part of the string
- what bytes are hashed
- whether line ending normalization happens
- whether digest mismatch is fatal

Example:

```text
`digest` uses `sha256:<hex>`. The digest is computed over the exact file bytes.
A mismatch is a validation error.
```

Do not say "hash or something similar." Implementers need a precise contract.

## Optional Folders

Optional folders should have clear purposes.

Example:

```text
`prompts/` contains prompt files referenced by the main resource.
`assets/` contains static files referenced by the main resource.
`docs/` contains human documentation and is not loaded by the runtime.
```

Do not require optional folders to exist. The main file should remain the
required entry point.

## Progressive Loading

For agent-facing and runtime-facing formats, explain loading stages.

A useful pattern:

1. Load lightweight metadata for discovery.
2. Load the main file when selected.
3. Resolve inheritance and references.
4. Validate the resolved artifact.
5. Pass an immutable snapshot to runtime code.

This tells authors why the format is split across files.

It also helps implementers avoid request-time surprises.

## Runtime Snapshot

If the runtime should not consume raw files directly, say so.

Example:

```text
The runtime receives a resolved profile snapshot. It does not read the pack
folder during a request.
```

This line creates an important boundary between authoring and execution.

It also clarifies where validation belongs: before runtime use.

## Inheritance And Layering

If the format supports inheritance, keep the rules simple.

Define:

- how a child names its parent
- where the parent is resolved from
- whether chains are allowed
- whether cycles are rejected
- whether missing parents are fatal
- how each field merges or replaces
- how provenance is recorded

Avoid saying "deep merge" without field-specific rules. Deep merge sounds
simple but becomes ambiguous for arrays, maps, and nested objects.

Better:

```text
Child profiles replace `systemPrompt` as a whole. Domain sections use
field-specific merge rules. Arrays replace by default unless a field defines a
different rule.
```

If you cannot define merge behavior clearly, use replacement only.

## Validation

The validation section should be concrete.

List what the validator checks:

- required entry file exists
- main resource parses
- known fields have valid types
- required fields are present
- names follow naming rules
- file references stay inside the pack
- digests match
- inheritance has no cycles
- unknown fields are handled according to policy
- the resolved artifact passes schema validation

If a validator command exists, show it:

```bash
format-ref validate ./my-pack
```

If the validator does not exist yet, still write the checklist. The checklist
becomes the implementation plan.

## Error Handling

Specs should say which failures are fatal.

Examples of fatal errors:

- missing required file
- invalid YAML or JSON
- unknown required parent
- path escapes the pack root
- digest mismatch
- ambiguous binding
- unsupported schema version

Examples of warnings:

- unused optional file
- missing human README
- deprecated field that can still be migrated

Do not leave error severity to guesswork.

## Unknown Fields

Every structured format needs an unknown-field policy.

Options:

- reject unknown fields everywhere
- reject unknown fields in common sections but allow domain sections
- allow unknown fields only under `metadata`
- ignore unknown fields with diagnostics

Pick one and write it down.

For portable specs, this is often a good default:

```text
Unknown fields in the common schema are validation errors. Unknown
domain-named sections may be ignored by implementations that do not own or
understand them.
```

## Versioning

Define the version field early.

Say:

- where the version lives
- what values are valid
- how incompatible versions are rejected
- whether minor versions are allowed
- whether the version names a schema, API group, or package release

Example:

```yaml
apiVersion: example.io/v1
```

Then explain:

```text
`apiVersion` identifies the resource schema. Implementations that do not
support `example.io/v1` must reject the resource.
```

Avoid version strings like `v1alpha1` unless you really mean an unstable API.

## Experimental Fields

Mark experimental fields clearly.

Say what is experimental:

- the field name
- the allowed values
- implementation support
- runtime behavior

Example:

```text
`allowedTools` is experimental. Implementations may ignore it. Authors must not
depend on it for security enforcement.
```

Do not let experimental behavior look stable in examples unless the example is
explicitly about experimental behavior.

## What The Format Does Not Cover

Add a short boundary section.

A good boundary section prevents misuse without sounding defensive.

Example:

```text
This format describes how to package runtime profile settings. It does not
store provider credentials, HTTP headers, server launch arguments, or cache
settings.
```

Keep this section concrete. Do not turn it into a long list of philosophical
non-goals.

## Security And Trust

If the format can load files, scripts, remote resources, or private data, add a
security section.

Cover:

- whether executable code is allowed
- whether remote fetches happen
- whether paths can escape the pack
- whether symlinks are followed
- whether digests or signatures are supported
- whether validation happens before runtime use
- whether untrusted packs are allowed

If the safe answer is "not supported yet," say that.

Example:

```text
The core format does not execute code. Runtimes must resolve file references
before use and reject paths that escape the pack root.
```

## Implementation Differences

Cross-project specs need room for implementation differences.

Document differences without making the common spec meaningless.

Good:

```text
The common schema defines `thinkingLevel`. Each driver decides whether the
selected model supports the requested level. Unsupported levels fall back
according to the driver's documented capability rules.
```

Weak:

```text
Implementations may interpret fields however they want.
```

The first version preserves a common contract and still lets runtimes enforce
their own capabilities.

## Writing Style

Use normal words.

Prefer:

- file
- folder
- field
- name
- load
- validate
- choose
- resolve
- reject
- use

Use technical terms when they are the right terms. Avoid abstract filler.

Weak:

```text
The format facilitates extensible behavior configuration across heterogeneous
runtime surfaces.
```

Better:

```text
The file tells the runtime which behavior to use.
```

## Sentence Pattern

Use this pattern often:

1. Say the rule.
2. Say why it exists if the reason changes behavior.
3. Show an example.

Example:

```text
Referenced files must stay inside the pack root. This keeps packs portable and
prevents a profile from reading arbitrary local files.

Valid: `./prompts/system.md`
Invalid: `../shared/system.md`
```

## Normative Language

Use requirement words carefully.

Use:

- `must` for validation and runtime requirements
- `must not` for forbidden behavior
- `should` for strong recommendations
- `may` for allowed behavior
- `experimental` for unstable behavior

You do not need RFC-style uppercase everywhere. Plain lowercase is easier to
read in product docs.

Make sure hard rules are still unmistakable.

## Examples

Examples should be close to the rules they explain.

Use several small examples instead of one massive example.

Good example types:

- minimal valid artifact
- full artifact
- valid field value
- invalid field value
- valid file path
- invalid file path
- inheritance example
- validator command

Every example should teach one thing.

## Bad And Better Examples

Use bad and better examples when the distinction is not obvious.

Example:

```yaml
# Bad: local behavior in common schema
spec:
  common:
    toolMode: lean
```

```yaml
# Better: local behavior in owner section
spec:
  example.io:
    toolMode: lean
```

Bad examples are useful when they match mistakes people will actually make.

Do not overdo them. Too many bad examples make the spec feel noisy.

## Tables

Use tables for structured comparisons.

Good table uses:

- field summary
- enum values
- error types
- lifecycle stages
- directory entries

Poor table uses:

- long prose
- multi-paragraph rationale
- deeply nested schema
- anything with many line breaks

If a table is hard to read in raw Markdown, use bullets instead.

## Notes And Callouts

Use notes for guidance that matters but is not part of the main rule.

Example:

```text
Most packs do not need a `compatibility` field.
```

Do not put core requirements only in notes. Requirements belong in the main
text or the field section.

## Keep Motivation Short

Motivation is useful, but it should not delay the format.

A short motivation section can explain:

- what problem the format solves
- why files are split this way
- why validation happens before runtime
- why extension points are limited

Avoid long essays before the first example.

## Explain The Lifecycle

A lifecycle section is helpful for runtime formats.

Example:

1. Author writes a pack.
2. Validator checks the pack.
3. Installer records provenance.
4. Runtime loads the pack at startup.
5. Resolver applies inheritance.
6. Runtime receives a resolved snapshot.

This makes hidden runtime assumptions visible.

## Keep The Core Small

A spec becomes hard to adopt when the first version tries to solve everything.

Good first-version scope:

- required file shape
- main schema
- path rules
- validation
- basic extension points

Later-version scope:

- remote registries
- signatures
- lockfiles
- dependency resolution
- marketplace metadata
- advanced merge behavior

Write future plans as future plans. Do not make them part of the core format
until they are ready.

## Avoid Common Spec Mistakes

### Starting Too Abstract

Do not start with a framework. Start with the file.

### Hiding Required Rules In Prose

If a field is required, put that in a table or bullet list.

### Mixing Portable And Local Behavior

Keep shared fields separate from implementation-owned fields.

### Leaving Defaults Ambiguous

Say what happens when a field is omitted.

### Saying "Deep Merge"

Define merge behavior per field.

### Allowing Generic `extra`

Open-ended maps become invisible APIs. Prefer named extension sections.

### Overusing Examples With Fake Values

Use realistic examples. Fake placeholders make the format feel less real.

### Adding Security Later

Path, execution, and remote-fetch rules belong in the first version.

## Good Spec Checklist

Use this checklist before publishing a format spec:

- The first concrete example appears near the top.
- The minimum valid artifact is obvious.
- Required fields are listed in one place.
- Optional fields explain omission behavior.
- Naming rules are exact.
- Valid and invalid examples are included for tricky fields.
- File path rules are explicit.
- Unknown-field behavior is defined.
- Extension points have boundaries.
- Runtime loading order is explained.
- Validation errors are listed.
- A validator command or checklist exists.
- Common fields are not polluted with implementation-specific behavior.
- Future work is clearly separate from the current contract.
- The prose uses direct verbs and concrete nouns.

## Template

Use this as a starting point.

````markdown
# Specification

This specification defines the file format for [thing].

## Structure

[Thing] is a [file/folder/resource] with [required entry point].

```text
thing-name/
├── manifest.yaml
└── files/
```

## Minimal Example

```yaml
apiVersion: example.io/v1
kind: Example
metadata:
  name: basic
spec: {}
```

## Main File

`manifest.yaml` contains one `Example` resource.

## Fields

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `apiVersion` | Yes | string | Schema version. |
| `kind` | Yes | string | Resource type. |
| `metadata` | Yes | object | Resource identity. |
| `spec` | Yes | object | Resource content. |

## `metadata`

Define name and namespace rules.

## `spec`

Define common fields.

## Implementation-Owned Sections

Define namespaced extension sections.

## File References

Define path resolution and pack boundary rules.

## Resolution

Define inheritance, merge behavior, and final snapshots.

## Validation

List validator checks and show the command.

## Extension Points

Explain what can grow and where.

## Boundaries

Explain what this format does not contain.
````

## Final Rule

A format spec should make the simple case feel simple.

The reader should finish the first half of the page knowing how to create a
valid artifact. The second half should help them understand validation,
runtime behavior, and extension points without changing the basic mental model.
