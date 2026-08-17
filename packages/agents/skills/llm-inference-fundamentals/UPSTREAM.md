# Sources and license

BentoML joined Modular through a strategic product acquisition announced on
2026-02-10:

- https://www.modular.com/blog/bentoml-joins-modular
- https://www.bentoml.com/blog/bentoml-is-joining-modular

The handbook commits used here belong to the same Git lineage. The final skill
contains one merged corpus.

## Source revisions

The base is Modular's handbook revision
`317b9816ec3080031333ed9ee44dfce919763bf7` from 2026-07-24:

https://github.com/modular/llm-inference-handbook

The merge input is the earlier BentoML revision
`ea07b2ccd9b35db810763fc76980b26be1d2b871` from 2026-07-01:

https://github.com/bentoml/llm-inference-handbook

Both repository URLs currently expose the same later `main` commit. The pinned
revisions identify the exact states compared during the merge.

## Knowledge merge

A heading and paragraph-level semantic comparison identified older material
that was genuinely absent from the Modular revision. Rewritten material was
excluded. Two concepts were retained:

- Hybrid overflow from an on-prem baseline to cloud GPUs.
- BentoML's `llm-optimizer` configuration-exploration workflow.

The retained text is maintained under `scripts/retained/` and inserted into the
corresponding current pages during import. Each inserted section includes a
source note. The importer verifies characteristic passages against the pinned
BentoML checkout before applying either insertion, so a future source change
cannot silently detach the merged text from its provenance.

Other apparent deletions were newer rewrites, expanded explanations, product
marketing, or superseded resource lists. The merge does not append those blocks
or preserve a duplicate older handbook tree.

## License

At both commits, handbook files under `docs/` use Creative Commons Attribution
4.0. The license is reproduced in [references/LICENSE](references/LICENSE).
Repository code outside `docs/` uses Apache-2.0 and is not part of the reference
corpus.

The earlier version of this skill mistakenly copied the repository's root
Apache license beside the handbook documentation. The importer now copies
`docs/LICENSE`, which is the license that applies to the vendored prose.

## Import transformations

The importer converts the Modular base to local Markdown, then applies the two
reviewed knowledge patches. Its mechanical work also removes site imports,
newsletter forms, card placeholders and marketing buttons. Layout wrappers are
unwrapped, interactive widgets become links to their rendered pages, images are
pinned to the source commit, and internal routes become local Markdown links.

The reasoning rules in `SKILL.md` are original synthesis. Product-specific
examples and quotations retain their source attribution.

## Reproduce the merge

Use clean checkouts at the pinned commits:

```bash
python3 scripts/vendor_handbooks.py \
  --bentoml-source /path/to/bentoml-handbook-checkout \
  --modular-source /path/to/modular-handbook-checkout
```

The script rejects a checkout at the wrong commit or with modified files under
`docs/`. It builds both inputs in temporary directories, verifies the retained
BentoML passages, creates one merged corpus and replaces `references/`
transactionally.
