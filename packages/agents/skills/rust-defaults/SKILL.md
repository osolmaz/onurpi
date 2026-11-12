---
disable-model-invocation: true
name: rust-defaults
description: Use when starting, reviewing, or standardizing a Rust project or crate, including workspace layout, lints, error handling, public API design, option structs, traits, unsafe policy, dependencies, testing, fuzzing, benchmarks, and release hygiene. Provides production-oriented default choices, the style guides to follow, and well-kept repositories to read, while preserving deliberate existing project decisions.
---

# Rust Defaults

Choose boring, maintained crates with clear ownership. Prefer the standard library when it
already provides the behavior. These defaults are a starting point: depart from one with a
stated reason, and respect a coherent existing choice unless it causes a concrete correctness,
security, or maintenance problem.

## Workflow

1. Read `Cargo.toml`, the workspace lints, the repository instructions, the architecture
   document, and the adjacent code.
2. Tell an established project choice apart from accidental local reinvention.
3. State the proposed change and its tradeoffs before changing dependencies or public API.
4. Use one crate per responsibility. Remove the replaced path in the same change.
5. Run `cargo fmt`, `cargo clippy` with the workspace lints, the tests of the affected crates,
   `cargo deny check`, and the documentation build before you finish.

## Style guides

Follow these in this order when the repository has no rule of its own:

| Guide | Use it for |
|---|---|
| [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/checklist.html) | Names, conversions, traits to implement, documentation, future-proofing of a public API |
| [Pragmatic Rust Guidelines](https://microsoft.github.io/rust-guidelines) | Application and library design; it has a condensed text file for coding agents |
| rust-analyzer `docs/dev/style.md` | Everyday code style: public fields over getters, plain long local names, minimal tests, few dependencies |
| [Rust Design Patterns](https://rust-unofficial.github.io/patterns/) | Idioms, patterns and anti-patterns |
| `rustfmt` defaults | Formatting; do not hand-format |

## Types and API

- **A closed set is an enum.** Never compare a bare integer or string that stands for a mode,
  a version, or a kind. Convert the outside value in one function, which also decides what a
  missing or unknown value means.
- **Ask a table of behaviors.** When many places would compare the same enum, build one struct
  of named fields from it once, and let the code read the fields.
- **Parse into strict types at the border.** Use newtypes for identifiers, indexes, and units,
  and types that cannot hold an invalid value (`NonZero*`, a checked rectangle, a non-empty
  list). Pass those inward.
- **Options are one struct with `Default`.** Callers write `..Default::default()`. Avoid
  functions with many positional arguments and avoid boolean arguments.
- **Mark public enums and option structs `#[non_exhaustive]`** when new variants or fields are
  likely, so that adding one does not break callers.
- **A simple call and a full call share one core.** The simple form allocates and returns; the
  full form takes the caller's buffer, transform, or cache.
- **Use ownership for call-order rules.** A value that must be finished is consumed by
  `finish(self)`. A guard that must not outlive its owner borrows it.
- **The caller supplies outside resources** (files, fonts, time, randomness) through an
  argument or a trait. A library crate does no I/O by itself.
- **Public fields are fine** when any value is valid. Add a constructor and private fields only
  when there is an invariant to keep.
- **Add a compile-time test** that a type meant to be shared is `Send + Sync`.

## Errors

| Concern | Default | Use differently when |
|---|---|---|
| Library errors | A typed enum, with `thiserror` or a hand-written `Display` | The crate must have no dependencies |
| Application errors | `anyhow` at the top level only | The program must match on error kinds |
| Recoverable problems | A list of warnings returned beside the value | The caller must stop on the first problem |
| Broken invariants | `debug_assert!` plus a typed "internal" error | Never `panic!` on outside input |

Keep "the input cannot be read" apart from "one part was skipped". Never cut, clamp, or skip
silently. Give every input that can cost unbounded work a named limit, and make a hit limit its
own error variant.

## Lints and unsafe

Set lints once in the workspace `Cargo.toml` and inherit them in each crate.

- Deny `clippy::unwrap_used`, `clippy::expect_used`, `clippy::panic`, `clippy::indexing_slicing`,
  `clippy::todo`, and `clippy::unimplemented` outside tests, for code that reads outside input.
- Warn on `clippy::pedantic` and allow the single lints that do not fit, each with a reason.
- Put `#![forbid(unsafe_code)]` in every crate that needs no unsafe code. Keep unsafe code in
  few, named crates, each block with a `// SAFETY:` comment.
- Deny `missing_docs` on the public crate.

## Workspace

- Start with one crate. Split when a layer border must be enforced, the build time hurts, or a
  user needs one part alone. Do not add an empty crate as a placeholder.
- Keep dependencies in one direction and let a tool check the allowed edges.
- Keep automation and test tooling in an `xtask` crate or under `tools/`, never in a library.
- Pin the toolchain in `rust-toolchain.toml`. Commit `Cargo.lock` for applications and tools.
- Put heavy or optional parts behind Cargo features, and check each feature alone on CI
  (`cargo hack check --each-feature`).

## Default stack

| Concern | Default | Use differently when |
|---|---|---|
| Serialization | `serde` with the format's crate | A hot path needs a hand-written reader |
| CLI | `clap` with derive | A tool has one or two flags: use `std::env::args` |
| Async runtime | `tokio` | The program does no concurrent I/O: stay synchronous |
| Logging and tracing | `tracing` | A small library: return data, log nothing |
| Parallelism | `rayon` | The work is I/O bound |
| Property tests | `proptest` | |
| Snapshot tests | `insta` | Output is binary: store reference files and compare bytes or pixels |
| Fuzzing | `cargo-fuzz` (libFuzzer) with one target per parser | |
| Benchmarks | `criterion`, or a fixed command with stored results | |
| Coverage | `cargo-llvm-cov` | |
| Supply chain | `cargo-deny` for licenses, bans and advisories; `cargo-shear` or `cargo-machete` for unused dependencies | |
| Test runner | `cargo-nextest` for large suites | |

## Tests

- A test fails without the change that it guards.
- One small input per feature, with stored reference output that is reviewed like code.
- Offer a text form of intermediate structures and test on it, so that a change shows as a text
  difference before it shows in the final output.
- Fuzz every parser of outside input, and keep the corpus free of private files.
- Fix a flaky test; do not rerun it.

## Repositories to read

Read how a well-kept project solves a problem before you design the same thing. Take structure
and interface, never code, and check the license before you copy an idea closely.

| Repository | Read it for |
|---|---|
| `rust-lang/rust-analyzer` | Architecture document, style guide, layering of a large workspace |
| `BurntSushi/ripgrep` | Crate borders, error handling, comments |
| `rust-lang/regex` | A hard algorithm with strict tests and fuzzing |
| `BurntSushi/jiff` | Types that make wrong states impossible |
| `serde-rs/serde`, `dtolnay/syn`, `dtolnay/anyhow` | Public API design |
| `typst/typst` | A compiler and layout engine: caller-supplied environment, warnings beside results, separate export crates |
| `linebender/resvg` | Resolve everything before drawing; an immutable tree; reference-image tests |
| `harfbuzz/ttf-parser` | A parser of hostile binary input with no panics and no unsafe code |
| `linebender/tiny-skia` | Geometry types that cannot hold invalid values |
| `rustls/rustls` | Strict handling of hostile input |
| `bytecodealliance/wasmtime` | Heavy fuzzing in a large codebase |
| `rust-lang/cargo` | A large codebase that stayed maintainable for many years |
