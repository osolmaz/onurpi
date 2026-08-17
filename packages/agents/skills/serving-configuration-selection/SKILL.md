---
name: serving-configuration-selection
description: Use when choosing, tuning, validating, or recommending an LLM serving configuration, especially context limits, concurrency, sequence capacity, batching, and KV-cache settings. Uses engine-agnostic powers-of-two candidate testing, distinguishes active context from server capacity, separates prefill and decode workloads, and selects throughput or goodput winners with explicit safety, verification, and reproducibility rules.
---

# Serving Configuration Selection

Choose a serving configuration through coarse-to-fine measurements of context,
concurrency, latency, throughput, stability, and memory pressure. Keep the
method independent of any benchmark tool or inference engine.

## Define The Question

Choose the primary objective before selecting a winner:

- **Maximum throughput:** highest aggregate tokens per second.
- **Maximum goodput:** highest throughput that satisfies latency and error
  targets.
- **Maximum stable concurrency:** highest concurrency that completes reliably
  under a specified workload shape.
- **Interactive performance:** best per-user decode rate and tail latency at a
  representative load.

Report maximum-throughput and practical SLO-constrained points separately.
The highest concurrency is not automatically the best setting.

## Keep Context Meanings Separate

- **Server context limit:** maximum tokens the server accepts for one sequence.
  It is a capacity setting, not the length exercised by a request.
- **Prompt length:** measured input tokens after templating and tokenization.
- **Active start:** prompt tokens resident when decode starts.
- **Active end:** prompt plus generated tokens at the final decode step.
- **Active average:** prompt plus about half the generated tokens; useful for
  interpreting sustained decode.

A server configured for `64k` with a `1k` prompt does not produce a `64k`
active-context result. Label capacity tests as capacity tests and active-context
tests by measured tokens. Always verify token counts from responses or server
metrics; requested lengths are only targets.

## Use Powers-Of-Two Ladders

Use geometric ladders for discovery. They cover a wide range quickly and make
results comparable:

```text
active context: 1k, 2k, 4k, 8k, 16k, 32k, 64k, 128k, ...
concurrency:     c1, c2, c4, c8, c16, c32, c64, c128, ...
```

Use exact token values internally:

```text
1k=1024, 2k=2048, 4k=4096, 8k=8192, ...
```

Include an exact non-power-of-two product or model boundary when it matters,
such as `100000` or `102400`, after the neighboring power-of-two points. Do not
silently round a configured limit.

Start with the full powers-of-two ladder that is affordable. If time is
limited, establish `c1` across the context ladder, then climb concurrency at
representative short, medium, and longest practical contexts. Never infer
long-context concurrency from short-context results.

## Build Comparable Workloads

At each active-context target `N`, test prefill and decode separately.

**Prefill shape**

```text
headroom = max(64, N / 64)
input    = N - headroom - 1
output   = 1
```

Use minimal output so decode work does not contaminate TTFT and prefill
throughput.

**Decode shape**

```text
headroom = max(64, N / 64)
output   = min(1024, N / 4)
input    = N - output - headroom
```

This provides hundreds of decode steps while keeping active context near `N`.
Add a separate long-output stress family when the application regularly emits
more than 1024 tokens; do not make expensive stress output the baseline.

Also include one realistic application workload. Synthetic fixed-length
requests reveal capacity; a representative prompt/output distribution reveals
operational performance.

Keep model, weights, precision, KV-cache dtype, engine build, hardware,
replicas, sampling settings, request shape, and client location fixed while
evaluating context and concurrency candidates. Change one serving parameter
family at a time.

## Evaluate Candidates

1. Record exact model, engine, hardware, memory, server limit, sequence cap,
   batch-token cap, KV-cache settings, and endpoint/runtime identity.
2. Run one warmup and one verified smoke request.
3. Run concurrency in ascending powers of two for each workload and context.
4. Use at least `max(8, 2 * concurrency)` requests per point so every active
   slot performs useful work. Use more requests when variance is high.
5. Continue the ladder while aggregate throughput or goodput improves and the
   result remains stable.
6. After finding the last-good and first-bad powers of two, refine only that
   interval with operationally meaningful values, for example `c24` between
   `c16` and `c32`. Repeat boundary candidates at least three times.
7. Record every planned point as completed, skipped, or failed with a reason.

Use burst traffic for concurrency saturation. Use a separate request-rate
experiment for arrival-rate and queueing behavior; concurrency and requests per
second are not interchangeable.

Keep these limits distinct:

- client in-flight request concurrency,
- server in-engine sequence or batch concurrency,
- endpoint replica count,
- benchmark task or agent concurrency.

Size the server admission cap at or above the highest intended in-engine point.
Client concurrency above that cap is valid only when explicitly measuring
queueing.

## Stop And Extend Deliberately

Stop increasing a ladder when one of these is observed and confirmed:

- allocation failure, OOM guard, or unsafe memory headroom,
- repeated 4xx/5xx, timeout, disconnect, malformed output, or request failure,
- aggregate throughput is flat or falls across two points,
- p95/p99 TTFT or TPOT exceeds the declared SLO,
- per-user decode rate becomes operationally unacceptable,
- queueing dominates and additional concurrency produces no goodput.

Do not treat one transient failure as the boundary. Retry the same point after
a health probe; if it fails again, preserve the error and stop that ladder.
Do not lower safety guards merely to force a larger result.

If the largest point is still healthy and improving, extend with the next power
of two. Record why candidate testing stopped instead of treating the initial
grid as a hard ceiling.

## Verify Every Point

HTTP success alone is insufficient. Check:

- completed and failed request counts match the plan,
- outputs are nonempty and structurally valid,
- finish reasons and token usage are plausible,
- no hidden server errors, truncation, tool-call parse errors, or client exits
  occurred,
- measured prompt and output tokens match the claimed workload shape,
- telemetry covers the measurement interval rather than only startup or idle.

Capture at least:

- aggregate input and output tokens per second,
- per-request or per-user output tokens per second,
- TTFT and TPOT/ITL averages plus p50, p95, and p99,
- end-to-end latency, request rate, goodput, and error rate,
- peak memory or KV-cache pressure and utilization,
- exact raw artifact and log locations.

## Recommend A Configuration

Create a context-by-concurrency table that shows aggregate throughput,
per-user throughput, tail latency, goodput, errors, and memory pressure. Mark:

- maximum aggregate-throughput point,
- best SLO-constrained point,
- last stable and first unstable concurrency at each context,
- untested, skipped, and failed points,
- measured active token shape and configured server limit separately.

Keep retries and extensions in one model/deployment-level result set when the
tool supports it. Preserve normalized configuration, raw per-request data,
telemetry, logs, timestamps, and software revisions so the selected setting can
be reproduced.

For local inference, also use `$safe-inference-launch`. For Hugging Face
Inference Endpoints, also use `$hf-inference-endpoints` and pause the endpoint
as soon as configuration testing finishes.
