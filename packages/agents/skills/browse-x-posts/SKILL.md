---
name: browse-x-posts
description: Use when asked to browse, search, identify, summarize, or verify X/Twitter posts or tweets; find a post the user remembers; inspect a recent discussion or claim from X; or use Onur's private xTap browsing corpus as a source for latest information. Searches the private Hugging Face xTap dataset, reconstructs threads and linked content, and reports public X links with clear claim-versus-verification boundaries.
---

# Browse X Posts

Use Onur's private xTap store to search the X/Twitter posts that appeared while he was browsing.

The store is often better than public web search for finding a post Onur remembers, especially when X search is blocked, rate-limited, poorly indexed, or missing recent posts.

## Source

- System of record: private Hugging Face dataset `osolmaz/xtap-pool-data`.
- Implementation repository: `~/repos/xtap-pool`.
- Raw captures: `data/<contributor>/<YYYY>/<MM>/tweets-YYYY-MM-DD.jsonl`.
- The date in the filename is the capture-day partition. Use each record's `created_at` for when the post was published and `captured_at` or `pooled_at` for when xTap observed it.
- The corpus contains posts seen while browsing when xTap capture and synchronization were active. It is not a complete index of X, a complete account history, or proof that a post is still public.

Use locally configured `hf` authentication in place. Never print, copy, export, or persist the token elsewhere.

## When To Search It

Search the xTap store early when:

- the user says they saw or remember a tweet or X post;
- the user asks which account made a claim;
- public search cannot find a recent post;
- recent model releases, benchmark reports, software announcements, technical discussions, or community findings may help answer a latest-information request;
- the user asks to browse X, browse tweets, use X, or inspect their captured feed.

For broad research, use xTap alongside primary sources and ordinary web research. A post is evidence that someone made a claim, not independent proof that the claim is correct.

## Search Workflow

1. Create an auditable temporary workspace under `/tmp`, such as `/tmp/xtap-search-YYYYMMDD-topic`.
2. Inspect the current remote tree rather than trusting an old local snapshot:

```bash
hf datasets ls osolmaz/xtap-pool-data -R > /tmp/xtap-search-tree.txt
```

3. Start with recent capture files likely to contain the post. Download only those files:

```bash
hf download osolmaz/xtap-pool-data \
  data/osolmaz/YYYY/MM/tweets-YYYY-MM-DD.jsonl \
  data/osolmaz/YYYY/MM/tweets-YYYY-MM-DD.jsonl \
  --repo-type dataset \
  --local-dir /tmp/xtap-search-TOPIC
```

4. Search text case-insensitively. Try exact phrases, account names, model or product identifiers, spelling variants, abbreviations, and metric forms such as `tok/s`, `tokens/s`, `TPS`, and `throughput`.
5. Parse complete JSON records before drawing conclusions. Do not answer from truncated `rg` output.
6. If the first window misses, expand by capture date. Posts can be captured days after publication.
7. Group matching records by `conversation_id`, then inspect replies, reposts, quotes, and linked posts that are present in the corpus.
8. Resolve shortened links from `urls[].expanded`. Follow the primary source, repository, model card, paper, release note, or benchmark artifact when the claim matters.
9. Inspect attached media when the post puts its actual numbers or configuration in a screenshot. `media[].alt_text` is often empty, so do not assume the text record contains the image's evidence.
10. Save the selected records and inclusion notes in the temporary workspace when the result depends on several posts or comparisons.

A small standard-library parser is safer than line-oriented shell output:

```python
import glob
import json

for path in glob.glob("/tmp/xtap-search-TOPIC/data/**/*.jsonl", recursive=True):
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            post = json.loads(line)
            text = post.get("text", "")
            if "qwen3.6" in text.lower() and "nvfp4" in text.lower():
                print(post["url"], post["author"]["username"], text)
```

See [Store format and interpretation](references/store-format.md) for fields, thread reconstruction, content handling, and privacy boundaries.

## Evidence Rules

- Link to the public `url` on X in the answer, not only to the private dataset.
- Name the author, publication timestamp, capture timestamp when relevant, and exact artifact or configuration being discussed.
- Preserve important qualifiers: hardware, quantization, runtime, context, concurrency, batch size, prompt/output lengths, speculative decoding, cache type, and whether throughput is single-stream or aggregate.
- Label unverified statements as claims: `the post reports`, `the author claims`, or `the model card says`.
- Open linked primary sources before presenting a claim as established fact.
- If a post conflicts with a model card, benchmark artifact, or reproducible local result, report the mismatch explicitly.
- Do not compare isolated token-per-second numbers without matching the protocol.
- If a post has been deleted or is inaccessible, say that xTap captured it at a particular time. Do not imply current availability.
- Prefer the original post over repost wrappers and commentary. Include commentary only when it adds interpretation the user asked for.

## Content Handling

- Decode HTML entities such as `&lt;` when quoting text.
- Use `urls[].expanded` instead of `t.co` links when available.
- Treat `created_at` as publication time and `captured_at` or `pooled_at` as observation time.
- Use `conversation_id` to assemble captured portions of a thread.
- Use `in_reply_to`, `quoted_tweet_id`, `is_retweet`, and `retweeted_tweet_id` to distinguish original posts, replies, quote posts, and reposts.
- Check `article` for captured long-form X article content.
- Check media and article images when text refers to a chart, screenshot, table, or benchmark result.
- Metrics such as likes and views are capture-time snapshots and can be missing or stale. Do not present them as current counts without a live check.

## Privacy And Boundaries

- The dataset is private even though most captured X posts are public. Do not publish dataset paths, bulk exports, contributor activity, service-account data, or unrelated captured records.
- Do not expose `contributed_by`, pool membership, private configuration, credentials, or browsing patterns unless Onur explicitly asks for that information.
- Treat subscriber-only or otherwise restricted posts as restricted content. Do not quote or redistribute them beyond what the user explicitly requests and is entitled to access.
- Minimize retrieval: download and inspect the smallest useful date range, then expand only when needed.
- Keep temporary search data outside the OnurPi repository and remove it when it contains sensitive or unrelated material that no longer needs to be audited.

## Answer Shape

For a remembered-post lookup, return:

1. The likely post or short list of candidates.
2. Author and public X link.
3. What each post actually claimed.
4. The linked artifact, model, repository, or source.
5. The main protocol caveat or verification result.

For latest-information research, integrate relevant posts into the answer but distinguish:

- what the post claims;
- what its linked primary source supports;
- what independent or local evidence verifies.

Do not dump raw JSONL or a long list of weak keyword matches. Curate the smallest set that answers the question.
