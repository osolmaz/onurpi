---
name: llm-inference-fundamentals
description: Unified domain knowledge and a reasoning workflow for LLM inference performance, benchmarking, capacity planning, and production serving. Use for TTFT, ITL, TPOT, throughput, goodput, prefill and decode, KV cache, batching, PagedAttention, prefix caching, speculative decoding, quantization, parallelism, GPU memory sizing, routing, autoscaling, observability, or inference infrastructure. Merges the current Modular handbook revision with useful guidance retained from its earlier BentoML edition.
license: See UPSTREAM.md
---

# LLM inference fundamentals

This skill provides one operating model over a deduplicated reference corpus.
The corpus uses Modular commit
`317b9816ec3080031333ed9ee44dfce919763bf7` as its base and merges useful
material absent from that revision but present in BentoML commit
`ea07b2ccd9b35db810763fc76980b26be1d2b871`.

## Merge policy

BentoML joined Modular through an acquisition announced on 2026-02-10. The two
commits are revisions of the same handbook lineage. They are not treated as
independent handbooks.

A paragraph-level semantic audit found two substantive concepts from the older
revision that the newer text did not retain:

- Hybrid overflow from an on-prem baseline to cloud GPUs.
- `llm-optimizer` as a separate configuration-exploration tool.

Those concepts are merged into their corresponding pages with source notes. The
remaining apparent deletions were rewritten or expanded in the newer edition,
marketing copy, or superseded resource lists. They are not duplicated.

[UPSTREAM.md](UPSTREAM.md) records the acquisition, source commits, license,
audit policy, transformations and update command. Treat product-specific tools
and performance claims as examples from their named source. Do not turn them
into engine-neutral facts.

Use this file for the reasoning workflow. Open the merged references when a
question needs derivations, diagrams, implementation details or exact source
attribution.

## Working model

An inference request passes through admission and queueing, tokenization,
prefill, autoregressive decode, serialization plus transport. Prefill processes
the prompt in parallel and populates the KV cache. Ordinary decode generates one
token at a time while reading the active sequence's KV state.

Keep the deployed artifact separate from the abstract model. Weight format,
weight quantization, KV precision, tokenizer, kernels, inference engine, and
speculative draft are parts of the deployed stack. A comparison that changes
several of these is a stack comparison. It does not isolate the engine or the
quantization choice.

A server's maximum context length is capacity. Decode work depends on the tokens
actually resident in active sequences. Do not treat configured capacity as the
active workload.

Keep evidence classes explicit:

- A **measurement** comes from completed requests under a declared workload.
- An **estimate** applies a formula or extrapolation to stated inputs.
- A **ceiling** is a physical or architectural upper bound. It does not predict
  an end-to-end benchmark.

## Benchmark contract

Before interpreting a result, capture enough state to reproduce the work and the
measurement boundary.

1. Record the exact model artifact, tokenizer, weight and KV formats, engine
   revision and launch command. Include the kernels and hardware.
2. Declare prompt length, requested and completed output length, request count,
   concurrency, sampling parameters, and stopping behavior.
3. State whether prefixes and kernels were cold, warm, reused, or cleared.
   Record the graph-capture state too. Fresh-prefill tests require distinct
   uncached prefixes.
4. Preserve per-request latency distributions as well as aggregate throughput.
   Aggregate tokens per second can rise while each session becomes slower.
5. For speculative decoding, retain proposed and accepted draft tokens,
   acceptance length or rate, target verification traffic, and rejected work.
6. Keep every valid sample and declare the aggregation rule. Exclude a sample
   only for a recorded safety, correctness, or instrumentation failure.

Use outputs long enough to reach steady decode before making sustained-speed
claims. Content-dependent methods need multiple distinct semantic prompts.

## Metric rules

Use the definitions in
[LLM inference metrics](references/llm-inference-basics/llm-inference-metrics.md)
and always name the observation point.

- **TTFT** spans request arrival through delivery of the first output token.
  Client-observed TTFT can include queueing, tokenization, scheduling, prefill,
  first-token decode, serialization plus transport.
- **TPOT** is often calculated as
  `(end-to-end latency - TTFT) / (completed output tokens - 1)`. Report the
  actual denominator and whether the first token is excluded.
- **ITL** measures intervals between streamed tokens. Its distribution reveals
  stalls that a mean TPOT can hide.
- **Throughput** is completed work per unit time. State whether it counts input,
  output, or all tokens and whether the number is aggregate or per session.
- **Goodput** counts requests that meet declared latency SLOs. It is preferable
  to raw throughput when late requests are not useful service.
- **Effective prefill throughput** computed as prompt tokens divided by TTFT is
  an end-to-end ratio. It is not interchangeable with a kernel or rolling-server
  prefill metric.

Prefix reuse changes prefill work, so label warmed-prefix results as cache hits.
Speculative decode ordinarily begins after target prefill and does not explain a
lower fresh-prefix TTFT.

## Capacity and optimization sequence

Account for model weights, KV cache, runtime workspaces, graph captures,
allocator headroom, and non-model host memory. KV demand scales with active
sequence length and concurrency. Weight quantization and KV-cache quantization
are independent choices.

Tune in this order:

1. Prove correct model loading and output while memory and process safeguards
   remain active.
2. Freeze a representative workload, measurement boundary, and aggregation
   rule.
3. Measure a plain baseline before adding cache reuse, speculative decoding,
   disaggregation, or offloading.
4. Change one major dimension at a time and recheck correctness, memory
   headroom, TTFT, ITL, per-session speed, aggregate throughput, and goodput.
5. Raise concurrency or context capacity only while the selected SLO and memory
   floor continue to hold.

Use batching and continuous scheduling to improve utilization before assuming
that model compute is the only bottleneck. Use PagedAttention to manage KV
fragmentation, prefix caching only where reuse exists, speculation only where
acceptance repays draft and verification work, and parallelism only after
including communication cost. Scaling decisions should follow measured demand,
queue behavior, cold-start time, placement constraints, and failure domains.

## Topic routes

| Question | Merged reference |
| --- | --- |
| How inference, attention and generation phases work | [Inference mechanics](references/llm-inference-basics/how-does-llm-inference-work.md) |
| How to define latency/throughput/goodput | [Metrics](references/llm-inference-basics/llm-inference-metrics.md) |
| How to design or interpret a benchmark | [Benchmarking](references/inference-optimization/llm-performance-benchmarks.md) |
| How to size weights and KV memory | [Memory sizing](references/getting-started/calculating-gpu-memory-for-llms.md) |
| How batching and chunked prefill behave | [Batching](references/inference-optimization/static-dynamic-continuous-batching.md) |
| When prefix caching helps | [Prefix caching](references/inference-optimization/prefix-caching.md) |
| How to evaluate speculative decoding | [Speculative decoding](references/inference-optimization/speculative-decoding.md) |
| How to choose parallelism | [Parallelism](references/inference-optimization/data-tensor-pipeline-expert-hybrid-parallelism.md) |
| How GPU architecture and kernels affect speed | [GPU fundamentals](references/kernel-optimization/gpu-architecture-fundamentals.md) |
| How to plan routing, scaling and observability | [Infrastructure](references/infrastructure-and-operations/what-is-llm-inference-infrastructure.md) |
| How hosted, BYOC, hybrid and on-prem options differ | [Deployment guidance](references/getting-started/serverless-vs-self-hosted-llm-inference.md) |

The merge audit and source boundaries are documented in
[references/README.md](references/README.md).
