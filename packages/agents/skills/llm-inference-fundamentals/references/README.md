# Merged LLM inference handbook

This directory contains one deduplicated corpus. The Modular revision
at `317b9816ec3080031333ed9ee44dfce919763bf7` supplies the base text. The import
then restores substantive guidance found in the BentoML snapshot at
`ea07b2ccd9b35db810763fc76980b26be1d2b871` but absent from the later revision.

The retained BentoML material covers:

- Hybrid overflow from on-prem clusters to cloud GPUs.
- `llm-optimizer` as an alternative configuration-exploration tool.

A paragraph-level semantic audit found that the other apparent deletions were
rewrites, material expanded in the Modular revision, product marketing, or
superseded resource lists. They are not duplicated here.

The merged additions are labeled inside the relevant pages. All other prose
comes from the Modular base after mechanical conversion from MDX to local
Markdown. See [UPSTREAM.md](../UPSTREAM.md) for source history, acquisition
context, licensing, transformation rules, and the reproducible import command.
