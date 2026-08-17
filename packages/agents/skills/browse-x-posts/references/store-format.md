# Store format and interpretation

## Raw capture layout

The private dataset `osolmaz/xtap-pool-data` stores raw post captures under:

```text
data/<contributor>/<YYYY>/<MM>/tweets-YYYY-MM-DD.jsonl
```

Each line is one JSON object. The partition date describes when the record entered that daily capture file. It may differ from the date in `created_at` because Onur can encounter an older post while browsing.

The dataset is the durable system of record. A local Hugging Face cache can be incomplete or stale, so list or download the current remote revision before claiming that a post is absent.

## Common fields

| Field | Meaning |
|---|---|
| `id` | X post ID. |
| `url` | Public X URL. Prefer this in answers. |
| `text` | Captured post text. It can contain HTML entities. |
| `created_at` | Publication timestamp reported by X. |
| `captured_at` | Time the xTap client observed the post. |
| `pooled_at` | Time the shared pool accepted the record. |
| `author.username` | X handle without `@`. |
| `author.display_name` | Display name at capture time. |
| `lang` | Language code reported or inferred by X. |
| `metrics` | Capture-time likes, reposts, replies, views, bookmarks, and quotes. Values can be absent or stale. |
| `urls` | Links extracted from the post. Prefer each entry's `expanded` URL over `shortened`. |
| `media` | Photos, videos, and other media references. `alt_text` is often null. |
| `hashtags` | Captured hashtag records. |
| `mentions` | Captured account mentions. |
| `conversation_id` | Root conversation ID used to group thread records. |
| `in_reply_to` | Parent post ID for a reply. |
| `quoted_tweet_id` | Post ID quoted by this post. |
| `is_retweet` | Whether the record is a repost wrapper. |
| `retweeted_tweet_id` | Original post ID for a repost when available. |
| `is_subscriber_only` | Whether X marked the post as subscriber-only. |
| `source_endpoint` | X endpoint through which the post was observed. Internal provenance, not usually useful in answers. |
| `contributed_by` | Pool contributor identity. Private browsing metadata; do not expose by default. |

Records can also contain long-form article fields such as `is_article` and `article`. Inspect the actual object rather than assuming every record has the same optional keys.

## Finding recent posts

`created_at` and the capture partition answer different questions:

- "What was posted today?" Filter and sort by `created_at`.
- "What did Onur recently see?" Start with the newest capture files and use `captured_at` or `pooled_at`.
- "What was the tweet I saw this week?" Search recent capture files even if `created_at` is older.

When the user asks for latest information, start with a bounded recent capture window, then follow links and verify the newest source revision or publication date.

## Reconstructing conversations

1. Find the matching record.
2. Collect records with the same `conversation_id`.
3. Order by `created_at`.
4. Use `in_reply_to` to establish direct parent-child relationships.
5. Resolve `quoted_tweet_id` and `retweeted_tweet_id` against captured `id` values when present.
6. State when only part of a thread was captured. Shared `conversation_id` does not guarantee every post in the conversation is available.

Do not collapse different authors' replies into the original author's position.

## Linked content

A post often summarizes a primary source imprecisely. Follow:

- `urls[].expanded` for repositories, model cards, papers, release notes, articles, and benchmark pages;
- `media[].url` for screenshots and charts;
- quoted or replied-to post IDs when they contain the missing context.

For technical performance claims, extract at least:

- exact model and quantization;
- runtime and version;
- hardware and device count;
- context length and cache type;
- concurrency or batch size;
- prompt and output lengths;
- single-stream versus aggregate throughput;
- speculative decoding method and draft length;
- whether the number is end-to-end, decode-only, or includes prefill.

Without those fields, two throughput values are usually not comparable.

## Search quality

Use several query forms. X posts frequently vary punctuation and naming:

- `Qwen3.6`, `Qwen 3.6`, `Qwen3-6`;
- `35B-A3B`, `35b a3b`, `35B A3`;
- `NVFP4`, `FP4`, `ModelOpt`;
- `tok/s`, `tokens/s`, `tokens per second`, `TPS`;
- handles, repository owners, model IDs, and shortened product names.

Search text, expanded URLs, author usernames, and optional article text. A model ID may appear only inside an expanded Hugging Face link.

## Reliability boundaries

The corpus proves that a particular record was captured, subject to ordinary software and source-data limitations. It does not by itself prove:

- that the post is true;
- that the account independently ran the benchmark;
- that a screenshot is authentic;
- that the post remains public;
- that every post Onur saw was captured successfully;
- that no relevant X post exists outside Onur's browsing feed.

Use post language carefully. `The author reported 95 tok/s` is supported by the capture. `The model runs at 95 tok/s` requires protocol-matched verification.

## Private-store boundaries

The raw posts are mostly public-source material, but the collection is private and reveals browsing behavior. Keep these distinctions clear:

- Public by default: original X URL, public author handle, public post text needed to answer the question, and public expanded links.
- Private by default: contributor identity, pool membership, capture volume, unrelated records, service-account configuration, credentials, and browsing-history patterns.
- Restricted: subscriber-only posts and any content no longer available to the user through its original access controls.

Do not turn a focused lookup into a bulk export. Do not commit downloaded records or temporary search artifacts to the tools repository.
