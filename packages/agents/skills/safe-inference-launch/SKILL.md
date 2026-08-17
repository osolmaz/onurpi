---
name: safe-inference-launch
description: Use before starting, smoke-testing, benchmarking, compiling, or recovering local LLM inference runtimes such as vLLM, SGLang, llama.cpp, TensorRT-LLM, Ollama, LM Studio CLI, FlashInfer, or modelopt-backed servers. Prevents local OOM incidents through target verification, earlyoom/process watchdogs, memory preflight, staged launches, unified-memory diagnostics, and explicitly authorized GPU reset recovery.
---

# Safe inference launch

Use this skill before any local inference process can allocate large CPU RAM,
GPU memory, swap, or compile caches.

This skill is mandatory for local starts of:

- `vllm serve`, `python -m vllm`, `api_server`, `gpu_worker`
- `llama-server`, `llama-cli`, `llama-bench`
- SGLang, TensorRT-LLM, TGI, MAX, Ollama, LM Studio CLI
- FlashInfer, modelopt, Triton, CUDA, or large safetensors/GGUF compile/load paths

Do not use this skill for a remote API request unless the command would also
start local containers or local model serving.

## First decision

Before launching anything local, verify the intended target:

1. If the user intended a remote endpoint, API, or cloud provider, test that
   endpoint first. Do not start a local model as a fallback unless the user
   explicitly asks for local fallback.
2. If the target is local, continue with the guard workflow below.

Remote endpoint checks should be small and non-streaming:

```bash
curl -sS -i "$OPENAI_BASE_URL/models" \
  -H "Authorization: Bearer $OPENAI_API_KEY" | sed -n '1,40p'
```

If auth or endpoint access fails, report that. Do not compensate by launching a
local runtime.

## Runtime provenance gate

Before downloading, installing, patching, or launching a runtime, apply the
provenance rules in `$manage-runtimes`.

A model-serving or benchmark request does not authorize a community image,
fork, custom build, benchmark-author image, or third-party patch set. These
require explicit approval before download or execution. If the canonical or
official runtime fails, stop and report the failure instead of substituting a
new runtime source.

Do not delete an incumbent runtime, container image, model cache, or benchmark
artifact to satisfy a disk preflight without explicit approval for the named
cleanup candidate.

## Required local guard workflow

Never start local inference with a raw command. Use the bundled watchdog:

```bash
~/.codex/skills/safe-inference-launch/scripts/guarded-launch.sh \
  --label qwen-vllm \
  --min-mem-gb 24 \
  --min-swap-gb 4 \
  --poll-sec 1 \
  -- \
  vllm serve ...
```

The guard:

- refuses to run unless `earlyoom` is active, unless explicitly overridden
- starts the command in its own process group
- polls `MemAvailable` and `SwapFree`
- sends `TERM`, then `KILL`, to the whole process group if pressure crosses the
  configured floor
- exits `137` when it killed the launch for memory pressure

## Automatic shims

Prefer automatic shims over relying on a human or agent to remember the guard.

Install PATH-level shims:

```bash
~/.codex/skills/safe-inference-launch/scripts/install-shims.sh
```

That creates guarded command names such as `~/.local/bin/vllm` and
`~/.local/bin/llama-server`. They resolve the real binary later in `PATH` and
run it through `guarded-launch.sh`.

For scripts that call an absolute runtime path, wrap the binary in place:

```bash
~/.codex/skills/safe-inference-launch/scripts/install-shims.sh \
  --wrap ~/runtimes/vllm/current/.venv/bin/vllm
```

The in-place wrapper moves the original executable to `vllm.real` and replaces
`vllm` with a guarded shim. This protects existing scripts that already point at
the absolute runtime binary.

Generated shims use these default guard floors:

- `SAFE_INFERENCE_MIN_MEM_GB=24`
- `SAFE_INFERENCE_MIN_SWAP_GB=4`

Override those environment variables only for a specific command or benchmark.

Uninstall managed shims with:

```bash
~/.codex/skills/safe-inference-launch/scripts/install-shims.sh --uninstall
~/.codex/skills/safe-inference-launch/scripts/install-shims.sh \
  --uninstall --wrap ~/runtimes/vllm/current/.venv/bin/vllm
```

Use `--allow-no-earlyoom` only for tiny CPU-only tests or when the user
explicitly accepts the risk. Do not use it for vLLM, llama.cpp servers, CUDA,
FlashInfer, TensorRT-LLM, or large model loads.

## Preflight

Run these before the guarded launch:

```bash
free -h
df -h "$HOME"
ps -eo pid,ppid,stat,rss,etime,cmd --sort=-rss | head -25
nvidia-smi
pgrep -a earlyoom
```

Then state the launch budget:

- model and quantization
- expected weight/cache footprint if known
- context length
- max concurrent sequences or users
- guard thresholds
- expected disk/cache growth

If disk is tight, do not clear caches or delete Docker state unless the user
explicitly approves or already asked for cleanup. Report what would be removed.

## Unified-memory recovery

On shared CPU/GPU memory systems such as NVIDIA GB10, inspect the server,
kernel, and `earlyoom` logs before retrying a failed load. A driver allocation
warning can be recoverable, while a later watchdog signal may be the event that
actually stopped the process.

Read [the unified-memory recovery runbook](references/unified-memory-recovery.md)
before changing watchdog thresholds, stopping a display manager, resetting a
GPU, or requesting a reboot. Keep both `earlyoom` and `guarded-launch.sh`
protection active during temporary model-loading peaks. Require explicit user
approval before any action that interrupts the graphical session or resets GPU
state.

## Safe defaults

For large GPU servers on an interactive workstation:

- `--min-mem-gb 24`
- `--min-swap-gb 4`
- `--poll-sec 1`
- conservative first start: `max_num_seqs <= 4`, context `<= 16k`
- full benchmark only after a successful smoke test

For known-stable local benchmark servers:

- `--min-mem-gb 16`
- `--min-swap-gb 2`
- keep the same process guard for the full benchmark

For small CPU-only llama.cpp tests:

- `--min-mem-gb 8`
- `--min-swap-gb 1`

Raise the floors when the desktop/session must stay responsive or when the
machine has known background jobs.

## Staged launch

Use stages. Do not jump straight to a full benchmark.

1. Start the server with the guard.
2. Wait for readiness with a small `/v1/models` or health check.
3. Run one tiny completion through the intended model.
4. Inspect runtime evidence for the actual attention, linear, MoE, quantization, and speculative-decoding backends that matter to the claim.
5. Stop if the observed backend differs from the requested backend.
6. Run one representative long-context smoke if the benchmark needs it.
7. Only then start Harbor, LocalPerf, or other benchmark traffic.

Backend imports, capability probes, available symbols, and server readiness are
not execution evidence. Require a real model request plus runtime logs or an
equivalent engine trace showing that the requested kernel executed. Treat any
unsupported-backend warning, fallback, emulation path, package mismatch, or
unexpected kernel as a failed smoke test. Stop the server, preserve the logs,
and label the run invalid rather than continuing under the requested backend's
name.

During benchmark traffic, monitor:

```bash
free -h
ps -eo pid,ppid,stat,rss,etime,cmd --sort=-rss | head -25
nvidia-smi
```

If the guard kills the process, treat the run as invalid infrastructure data,
not a model score.

## Stop conditions

Stop or refuse the run when:

- the runtime source is third-party and has not received explicit approval;
- the canonical or official runtime failed and continuing would substitute an unapproved source;
- the requested backend is not observed executing the intended model;
- logs show fallback, emulation, an unexpected kernel, or a package mismatch;
- `earlyoom` is absent or inactive for a large local inference launch;
- `MemAvailable` is already below the chosen floor;
- swap is nearly full before launch;
- disk has too little space for model/cache growth and cleanup is not explicitly approved;
- stale local inference processes are already consuming memory;
- the user asked for a remote endpoint and local launch would be a fallback.

Do not keep retrying after a memory-pressure kill without reducing local load
or moving back to the intended remote target.
