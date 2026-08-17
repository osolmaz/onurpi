---
name: openclaw-onur-inventory
description: Use when maintaining the OpenClaw Onur inventory repository, including periodic roughly every-2-hour refreshes, auditing OpenClaw local model and open-weight model issue/PR inventories, deciding whether a thread belongs in that file, sorting the inventory, updating the reviewed-through issue/PR watermark, or explaining why an item was included or excluded.
---

# OpenClaw Onur Inventory

Use this skill for `OPENCLAW_ONUR_INVENTORY.md` in the OpenClaw Onur inventory repository.

The inventory is curated. Do not regenerate it by dumping keyword hits.

## Periodic Cadence

Run this inventory maintenance periodically, normally about every 2 hours when the user asks for ongoing upkeep.

Each run must refresh live state, scrutinize candidates, update/curate the onurclaw inventory file if anything changed, sort it, and commit/push the onurclaw repo changes.

For unattended automation, use the public hardened job contract in `docs/inventory-job.md`. The cron prompt must tell the sandboxed agent to read `/workspace/.agents/skills/openclaw-onur-inventory/SKILL.md`, curate `/workspace/OPENCLAW_ONUR_INVENTORY.md` from `/gitcrawl/gitcrawl.db`, write candidates with `scripts/list_inventory_review_candidates.py --format jsonl --output /state/inventory-candidates.jsonl`, review that file in small chunks, then run `/workspace/scripts/finalize_inventory_job.sh`. The finalizer must export `/workspace/OPENCLAW_ONUR_INVENTORY.json` and notifier comparison must read that JSON, not parse Markdown tables. Do not reduce the cron job to a wrapper-only sort/compare step. Do not document or expose host-specific paths, credentials, message destinations, or the private security topology in public files. The automated runner must use an isolated sandbox, read-only exported Gitcrawl/notifier data, no network egress, no host secrets, and host-side pushing only. The sandbox does not have Codex `apply_patch`; use checked-in scripts or simple preflightable shell/Python commands for mechanical edits.

## Include Or Exclude

Keep a GitHub issue or PR only when the actual reported behavior or change is materially about at least one of:

- local model runtime or serving: Ollama, LM Studio, vLLM, llama.cpp, GGUF, MLX, local one-shot infer, local event-loop stalls, or local GPU/CPU serving paths
- self-hosted/OpenAI-compatible/proxy routing: OpenAI-compatible HTTP, openai-completions/responses, LiteLLM, Open-WebUI, custom baseUrl/provider, self-hosted embedding/ASR/TTS endpoints
- local memory/model infrastructure: QMD, local embeddings, memory embedding providers, rerankers, vector/FTS behavior, mixed vector spaces
- model routing correctness: fallback chains, model picker/switch, provider catalogs, auth-profile selection, actual backend model reporting, provider/model registry correctness
- open-weight/provider-family behavior when that model family is part of the bug or fix: Kimi, Qwen, DeepSeek, Moonshot, GLM/Z.ai, Gemma, Mistral, MiMo/Xiaomi, Nemotron, and similar provider paths

Drop generic channel, UI, gateway, cron, install, docs, memory, or bootstrap threads when a local/open-weight term is only incidental evidence.

Example exclusion: a remote native Moonshot/Kimi Discord dispatch delay is not local-model related unless the issue is specifically about local/self-hosted/OpenAI-compatible routing, local runtime behavior, or local embeddings.

## Refresh Workflow

1. Work at the root of the OpenClaw Onur inventory repository.
2. Verify Gitcrawl freshness and fetch live GitHub open issue/PR state.
3. Build a broad candidate pool from local/open-weight/provider terms.
4. You must review every candidate one by one. Keep direct/material matches and drop incidental body/comment/label matches.
5. Put closed or removed notable threads under the existing collapsed `<details>` block so they do not bloat the open inventory.
6. Update the `Review watermark` near the top of the file with the highest live GitHub issue number and highest live GitHub PR number that were covered by the review.
7. Keep open issues and open PRs together in one canonical `## OPEN THREADS` table. Mark the type inside the first cell with an emoji; do not add a separate type/kind column.
8. Run the sorter before committing so it generates `## NEW OPEN THREADS` with the newest 50 open rows, keeps the first 50 canonical `## OPEN THREADS` rows visible inline, places only the remaining open rows in a collapsed `<details>` block, sorts the canonical open table by `Activity` score descending and GitHub number descending/latest, fills creator handles and created dates from Gitcrawl where available, keeps closed/removed tables newest-first by GitHub number, and refreshes open-thread activity scores.
9. Recount rows and compare the retained issue/PR number sets before committing.

## File Shape

Keep the inventory file terse. The top of the file must contain only:

- title
- `Updated: YYYY-MM-DD`
- `Review watermark`
- generated `## NEW OPEN THREADS` section capped at 50 rows and visible by default
- canonical merged `## OPEN THREADS` table with the first 50 rows visible by default and only overflow rows collapsed
- collapsed closed/removed details
- short regeneration notes

Do not add or maintain these noisy generated sections:

- `Sources checked`
- `Audit result`
- `Inclusion criteria used`
- `HIGHEST-RISK OPEN AREAS`
- cumulative per-run source logs or review-range logs
- broad candidate counts unless the user explicitly asks for an audit report

Put audit details, source freshness, candidate counts, and rationale summaries in the chat response, commit message, or PR body instead of the inventory file.

`OPENCLAW_ONUR_INVENTORY.json` is the machine-readable mirror
for automation, with schema at
`schemas/openclaw-onur-inventory.schema.json`. Regenerate it
with `python3 scripts/export_inventory_json.py` or by running the finalizer.
Notifier compare and other automation must read the JSON mirror instead of
parsing the Markdown table.

## Review Watermark

The inventory must include a `Review watermark` section near the top of `OPENCLAW_ONUR_INVENTORY.md`.

Record:

- `Last reviewed through issue: #<number>`
- `Last reviewed through PR: #<number>`

Only advance these numbers after the run has considered all issues or PRs up to those numbers. If a run only reviews a subset, leave the corresponding watermark unchanged and say what range remains unchecked.

## Sorter

The inventory repository includes the sorter at `scripts/sort_openclaw_onur_inventory.py`.

From the inventory repository root, run:

```bash
python3 scripts/sort_openclaw_onur_inventory.py
```

By default the sorter also refreshes the `Activity` column for open issues and PRs using authenticated `gh api` calls. It fills the `Creator` column from local Gitcrawl data when a Gitcrawl DB is available, merges any old `OPEN ISSUES` and `OPEN PRS` sections into one canonical `OPEN THREADS` table, generates a `NEW OPEN THREADS` view with the newest 50 open rows using Gitcrawl `created_at_gh`, then sorts all canonical open rows together by `Activity` score descending and GitHub number descending. It keeps the first 50 canonical open rows visible and collapses only overflow rows. It keeps sorting/counting even if an activity lookup fails, and prints warnings for skipped threads. Use `--no-activity` or `OPENCLAW_ONUR_INVENTORY_SKIP_ACTIVITY=1` only for tests or emergency offline sorting.

## Activity Score

The `Activity` column is a single weighted, human-only count of current visible GitHub activity. It is the only priority-like ranking column in the open thread table; do not keep a separate `Priority` column.

The canonical open thread table must use this column order:

- `Thread`
- `Activity`
- `Area`
- `Creator`
- `Title`

The generated `NEW OPEN THREADS` table adds a `Created` column after `Thread`;
it is a derived view only. The canonical inventory source remains
`OPEN THREADS`.

The `Thread` cell must show the issue/PR kind with an emoji and the linked GitHub number, without adding a type/kind column. Use `&nbsp;` between the emoji and link so rendered markdown does not line-break between them:

- `📝&nbsp;[#123](https://github.com/openclaw/openclaw/issues/123)` for issues
- `🔀&nbsp;[#456](https://github.com/openclaw/openclaw/pull/456)` for PRs

The `Creator` cell must contain the GitHub issue opener or PR author handle, formatted as `@login`. Fill it from Gitcrawl (`threads.author_login`) when available. Leave it blank only when the source data lacks an author.

If a row has an assignee, put `Assignee: <name>` below the title in the `Title` cell.

Weights:

- First issue or PR conversation comment by a human account: `4`
- Additional issue or PR conversation comments by the same human account: `1`
- First PR review comment by a human account: `4`
- Additional PR review comments by the same human account: `1`
- First PR review body with non-empty text by a human account: `5`
- Additional PR review bodies with non-empty text by the same human account: `1`
- Reaction on the issue/PR body, conversation comments, or PR review comments: `1`

Classification and filtering:

- Count non-human activity separately by excluding it from the `Activity` score. An actor is non-human when GitHub reports the actor type as `Bot` or the login ends with `[bot]`.
- Exclude `osolmaz` and `dutifulbob` from the `Activity` score by default.
- Use `--ignored-account <login>` to add more excluded human accounts. This can be repeated. `OPENCLAW_ONUR_INVENTORY_IGNORED_ACCOUNTS` can also provide a comma-separated list.
- When GraphQL exposes minimized comment metadata, exclude comments where `isMinimized=true` and `minimizedReason=SPAM`.
- The current `Activity` cell format is only the total score, for example `45` on an issue or `82` on a PR.
- The canonical open thread table must be sorted first by `Activity` score descending, then by GitHub issue/PR number descending/latest. The generated `NEW OPEN THREADS` section must be sorted by GitHub creation date descending, then GitHub number descending/latest, and must not be parsed as the canonical inventory source.
- Closed or removed rows stay sorted by GitHub issue/PR number descending because they do not carry live activity ranking.

## Output Expectations

- Say whether counts are issues, PRs, or combined threads.
- When challenged on one item, you must check the live issue/PR body before defending it.
- If an item was included only because a provider/model name appeared incidentally, you must remove it.
- Keep the final GitHub link handy: `https://github.com/osolmaz/onurclaw/blob/main/OPENCLAW_ONUR_INVENTORY.md`.
