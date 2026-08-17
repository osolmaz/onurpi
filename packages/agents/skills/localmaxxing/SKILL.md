---
name: localmaxxing
description: Use when running, reviewing, preparing, validating, replacing, or submitting Localmaxxing LLM benchmarks. Enforces objective, representative measurements with adequate output length, uncached fresh-prefill testing, multiple distinct prompts, honest metric labels, complete raw evidence, guarded local inference, and public verification.
---

# Localmaxxing

Use Localmaxxing to report representative performance, not the largest number a
machine can produce. Be objective. Prefer a realistic result that survives
scrutiny over a favorable result caused by a short prompt, repeated prefix,
small sample, or ambiguous metric.

For local model launches, also use `$safe-inference-launch`. When choosing
context, concurrency, or server capacity, also use
`$serving-configuration-selection`.

## Hard Rules

- A request to benchmark a model does not authorize a community runtime, custom image, fork, or patch set. Use `$manage-runtimes` and obtain explicit approval before downloading or executing one.
- If the canonical or official runtime fails, stop and report it. Do not substitute a claimant's image or another community build.
- A claimant-provided runtime may be measured only as a separately labeled reproduction after explicit approval. Do not use it as the neutral implementation in a comparison.
- Never submit a warmed-prefix result as fresh prefill.
- Never hide slow samples, failures, safety events, or material configuration
  changes.
- Do not choose the best sample. Use the declared aggregation rule, normally the
  median of at least three valid samples, and preserve every sample.
- Generate enough tokens to measure sustained decode. Use at least 512 output
  tokens for a general decode result and prefer 1,024. A 256-token run is valid
  only when the intended workload is short, and must be labeled that way.
- Use multiple distinct semantic prompts for speculative decoding. Draft
  acceptance and speed depend on the generated content.
- Verify prompt and output token counts from endpoint usage or server metrics.
  Requested lengths and character counts are not token counts.
- Keep c1 per-request decode separate from aggregate multi-request throughput.
- Keep fresh prefill, cached-prefix reuse, decode, TTFT, and end-to-end speed as
  separate measurements.
- Do not submit until the payload, raw samples, server configuration, safety
  state, and public notes have been reviewed.

## What To Measure

Record these fields for every run:

- exact model and draft model IDs and revisions;
- runtime owner, source repository, version, commit, and image digest when applicable;
- requested and observed quantization, linear, MoE, attention, and speculative-decoding backends;
- KV-cache dtype and tensor parallelism;
- hardware identity and count;
- configured server context limit and measured prompt/output tokens;
- client concurrency and server sequence capacity;
- TTFT for a fresh prompt;
- client-observed inter-token decode speed;
- end-to-end output speed and total request time;
- effective prefill estimate, when useful;
- every sample, median, mean, spread, errors, and finish reasons;
- peak or minimum memory and swap headroom plus guard events;
- exact command, raw payload, logs, telemetry, and checksums.

Localmaxxing estimates prefill speed as:

```text
prompt tokens / TTFT
```

Call this a **client-observed effective prefill estimate**. TTFT also includes
request handling, tokenization, scheduling, and the first decode token, so it is
not kernel-only prefill throughput.

## Avoid Warmed-Prefix Prefill

Localmaxxing remote mode normally sends one warmup and then repeats the same
prompt for three timed requests. If the server has prefix caching enabled, the
timed TTFT and estimated prefill rate are cached-prefix measurements.

Do not publish those values as fresh prefill. Use one of these methods:

1. Keep the production server configuration, use `--warmup 0 --iterations 1`,
   and run at least three distinct prompts separately.
2. Disable prefix caching only when that matches the deployment being measured,
   then use the ordinary warmup-plus-repetitions protocol.

For distinct-prompt testing, change the first cache block, not only the suffix.
With chained prefix-cache hashes, a changed first block prevents the remaining
blocks from reusing the old prefix. Confirm the behavior with server cache
metrics when available.

A warm engine is still desirable. Warm JIT kernels, CUDA graphs, and request
paths with a short prompt that cannot share the benchmark prompt's first cache
block. Engine warmup and prompt-prefix warmup are different things.

If cached-prefix performance matters, measure it as a separate workload and
label it **cached prefix**. Report both fresh and cached values rather than
mixing them.

## Default Representative Workload

Use the application's real prompt and output distribution when known. If no
workload is specified, a defensible c1 long-form baseline is:

```text
prompt:      8,192 measured tokens
output:      1,024 measured tokens
concurrency: 1
samples:     at least 3 distinct uncached prompts
sampling:    fixed across samples
```

Also add short or very long workloads when they are operationally important.
Do not treat a 63-token prompt with 256 output tokens as a general sustained
performance result.

For a prefill-focused test, use a substantial fresh prompt and minimal output.
For a decode-focused test, use enough output tokens to reach steady generation.
For speculative decoding, use several content types such as explanatory prose,
code, structured text, and realistic application prompts.

## GGUF And llama.cpp

For the same semantic remote workload on GGUF, start `llama-server` and run:

```bash
lmx benchmark run llama.cpp \
  --mode remote \
  --base-url http://127.0.0.1:8000 \
  --served-model org/model-GGUF \
  --hf-id org/model-GGUF \
  --quantization Q4_K_M \
  --prompt "$(cat prompt.txt)" \
  --max-tokens 1024 \
  --warmup 0 \
  --iterations 1
```

This uses the OpenAI-compatible semantic endpoint path. Local `llama-bench`
mode uses synthetic prompt and output token counts, so it is not the same test.
A remote llama.cpp `--dry-run` may produce only a measurement plan; the actual
non-dry run performs the endpoint request. Verify filename-derived quantization,
the canonical Hugging Face repository ID, endpoint token usage, and the exact
Poolside or upstream llama.cpp revision before submission.

## Private Measurement Workflow

1. Confirm the intended endpoint and serving configuration.
2. For a local server, complete the guarded launch preflight and record the
   safety budget.
3. Keep submission disabled while measuring. Omit `--submit`; for hard
   isolation, use a temporary home with no Localmaxxing API key and verify
   `lmx auth whoami` returns `missing_api_key`.
4. Warm the engine with an unrelated short prompt.
5. Run at least three distinct uncached prompts as one-shot measurements:

```bash
HOME="$NOAUTH_HOME" XDG_CONFIG_HOME="$NOAUTH_HOME/.config" LMX_API_KEY= \
  lmx benchmark run vllm \
  --mode remote \
  --base-url http://127.0.0.1:8000 \
  --hf-id org/model \
  --served-model org/model \
  --quantization NVFP4 \
  --hardware hardware.json \
  --prompt "$(cat prompt-1.txt)" \
  --max-tokens 1024 \
  --temperature 0 \
  --warmup 0 \
  --iterations 1 \
  --out run-1.json
```

6. Repeat with `prompt-2.txt`, `prompt-3.txt`, and more prompts when variance is
   high.
7. Verify each request completed with the claimed output length and without a
   guard or server error.
8. Verify from server logs or an equivalent engine trace that the requested kernels executed. Configuration flags and availability probes are not enough.
9. Stop and invalidate the run if any relevant layer used fallback, emulation, an unexpected kernel, or a mismatched package.
10. Aggregate the fresh samples without dropping outliers. Use the median for the headline and include the mean and all sample values in notes.
11. Validate the final payload locally, then use the authenticated API dry-run.
12. Review the rendered numbers and notes before public submission.

## Submission Notes

State plainly:

- prompt and output token counts;
- number of distinct prompts and whether they were uncached;
- per-sample decode values, median, and mean;
- whether TTFT and prefill are fresh or cached;
- any separate cached-prefix result;
- runtime provenance, including owner, repository, version or commit, and image digest;
- requested backends and the backends observed executing;
- material deviations from the upstream serving recipe;
- safety floor and any guard event;
- where the raw evidence is stored.

Do not describe an estimated, cached, aggregate, or one-shot number as something
else. If evidence is incomplete, keep the result private.

## Replacing A Public Run

Prefer submitting the reviewed replacement first, verifying that it is
approved and visible, and only then deleting the superseded run. This avoids a
period with no valid result.

An in-place Localmaxxing edit can update the database while the model page still
serves an older cached rendering. Verify with all three surfaces:

1. an API query with a cache-busting parameter;
2. the public run URL in a fresh browser profile;
3. the old run URL after deletion, which should return 404.

Do not claim a replacement is complete until the ordinary public page shows the
new values.

## Stop Conditions

Do not submit when:

- the runtime source required approval and approval was not obtained before download or execution;
- the reported backend was configured but not observed executing;
- logs contain a relevant fallback, emulation path, unexpected kernel, or package mismatch;
- timed prefill reused the warmup prefix but is labeled fresh;
- output is too short to support the stated decode claim;
- fewer than three samples are available without a clear one-shot label;
- prompt or output token counts are inferred rather than verified;
- the guard fired, the server errored, or requests did not complete;
- the configuration or model revision is uncertain;
- only the best sample was retained;
- the ordinary public page still shows superseded values.
