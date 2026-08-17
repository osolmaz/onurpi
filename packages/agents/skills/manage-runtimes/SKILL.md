---
name: manage-runtimes
description: Use when creating, updating, selecting, promoting, auditing, or deleting local runtime environments for inference engines or benchmark toolchains such as vLLM, SGLang, llama.cpp, TensorRT-LLM, or FlashInfer-backed runtimes. Enforces canonical runtime paths, manifests, smoke tests, promotion rules, cleanup rules, and prevents ad hoc virtualenv or toolchain sprawl.
---

# Manage Runtimes

## Core Rule

Use canonical runtime roots instead of scratch, service, or repo-local environments.

Default layout:

```text
~/runtimes/<engine>/
  current -> versions/<runtime-name>
  versions/
    <runtime-name>/
      .venv/                 # only for Python runtimes
      manifest.json
      notes.md
      smoke.json
  profiles/
    <profile-name>.json
```

For vLLM, use:

```text
~/runtimes/vllm/current/.venv/bin/vllm
```

Do not create new inference runtime environments under `~/scratch`, `~/services`, `~/repos`, or project-local `.venv` directories unless the user explicitly approves a one-off exception.

## Version control

`~/runtimes` is the working tree for the private repository
`https://github.com/osolmaz/runtimes`. Its default-deny `.gitignore` tracks only
lightweight control and provenance files:

- runtime manifests and notes;
- serving profiles;
- setup and patch recipes;
- benchmark protocols and specs;
- concise failure or invalidation summaries.

Installed environments, binaries, compiled objects, source checkouts, model
files, caches, logs, telemetry, raw requests, benchmark results, databases, and
reports must remain ignored.

Before changing tracked runtime files, run `git pull --ff-only` in
`~/runtimes`. After every intentional tracked change:

1. Run `scripts/check-repo.sh`.
2. Inspect `git status --short` and stage only the intended files.
3. Never use `git add -f` to bypass the allowlist.
4. Commit with a Conventional Commit message.
5. Push `origin/main` in the same task unless the user explicitly requests
   local-only work.

If a new lightweight file type belongs in the repository, update the narrow
`.gitignore` allowlist and repository checks before adding it. Never run or
resume a benchmark recipe from a directory containing `INVALID.json`.

## Runtime provenance

A request to benchmark, serve, or test a model does not authorize a new runtime source.

Without further approval, use only:

- an existing canonical runtime under `~/runtimes/<engine>/`, or
- an official pinned release from the inference engine or model publisher.

Community images, forks, custom builds, benchmark-author images, and third-party
patch sets require explicit approval before download, installation, patching, or
execution. Before asking, report:

- owner and source repository;
- immutable commit, release, or image digest;
- expected download and installed disk cost;
- why the canonical or official runtime cannot be used;
- official alternatives;
- requested privileges, mounts, network access, and credentials.

If the canonical or official path fails, stop and report the failure. Do not
silently substitute another source. A claimant-provided runtime may be used only
for a separately labeled reproduction after approval, not as the neutral or
authoritative runtime in a comparison.

Treat every container image and prebuilt binary as executable code, not as model
data. Inspect available build provenance before requesting approval. Approval to
download model weights does not approve a runtime from the same author or from a
post discussing those weights.

## Default runtime policy

The promoted `current` runtime must be an official build from the engine
publisher (for example ggml-org, vllm-project, sgl-project) for the target
platform and accelerator. It must not be a community fork, a custom patch set,
or a model-specific build.

Fork, vendor, or model-flavored builds (for example `*-qwen36-*`, `laguna`,
`prism`) may exist under `versions/` only as archived candidates tied to a
named experiment or benchmark. They must never be promoted to the default
`current`. If an official build cannot serve the target model, keep the
special build as a candidate, record why the official build fails in its
manifest, and ask before promoting anything model-specific.

## Prebuilt-first gate

Building an inference runtime from source always requires explicit user
approval, including a build from official upstream source. A request to
benchmark, serve, or test a model does not authorize a source build.

Before proposing or starting a build, check these options in order:

1. Existing canonical runtimes under `~/runtimes/<engine>/`.
2. Official release binaries for the target operating system and architecture.
3. Official container images, including remote multi-platform manifests rather
   than only images already present locally.
4. Official packages or wheels for the target platform.

`Not installed locally` does not mean `not available`. For containers, inspect
the registry manifest for the target architecture before deciding that no
prebuilt image exists. If a compatible official prebuilt exists, use and pin it
unless the user explicitly requests a source build.

Before requesting source-build approval, report:

- the exact source repository and immutable revision;
- the evidence that each relevant canonical or official prebuilt is
  incompatible;
- expected build time and disk use;
- the intended canonical runtime path;
- the exact build command.

Do not configure or compile a runtime in `~/repos`, `~/scratch`, or another ad
hoc location. An approved source build belongs in a versioned directory under
`~/runtimes/<engine>/versions/`.

## Runtime Names

Name runtime versions by engine, version, purpose, and important hardware/backend traits:

```text
vllm-0.23.1-qwen36-sm121-flashinfer
vllm-0.23.1-qwen36-sm121-triton-safe
sglang-0.5.2-blackwell-cu130
llama-cpp-b6100-cuda-cu130
```

Prefer names that explain why the runtime exists. Avoid vague names like `test`, `latest`, `new`, or `scratch`.

## Manifest

Every promoted or candidate runtime must have `manifest.json`.

Minimum fields:

```json
{
  "name": "vllm-0.23.1-qwen36-sm121-flashinfer",
  "engine": "vllm",
  "status": "candidate",
  "created_at": "2026-07-01",
  "runtime_path": "/home/bob/runtimes/vllm/versions/vllm-0.23.1-qwen36-sm121-flashinfer",
  "executable": "/home/bob/runtimes/vllm/current/.venv/bin/vllm",
  "versions": {
    "python": "3.12",
    "vllm": "0.23.1rc1",
    "torch": "2.11.0+cu130",
    "cuda": "13.0",
    "flashinfer": "0.6.13"
  },
  "hardware": {
    "cuda_arch": "sm_121",
    "flashinfer_cubins": ["sm121"]
  },
  "source": {
    "trust": "official",
    "owner": "vllm-project",
    "repo": "https://github.com/vllm-project/vllm",
    "commit": "",
    "image": null,
    "digest": null,
    "approval": null
  },
  "smoke_tests": [],
  "notes": ""
}
```

Use `status` values:

- `candidate`: created but not trusted yet
- `working`: smoke-tested and safe to use
- `archived`: kept for reproducibility, not the default
- `broken`: known bad, kept only for debugging

## Profiles

Keep model-specific serve flags in `profiles/`, not scattered through benchmark specs.

Profile example:

```json
{
  "name": "qwen36-35b-nvfp4-spark",
  "model": "nvidia/Qwen3.6-35B-A3B-NVFP4",
  "runtime": "vllm-0.23.1-qwen36-sm121-flashinfer",
  "env": {
    "CUTE_DSL_ARCH": "sm_121a",
    "FLASHINFER_DISABLE_VERSION_CHECK": "1"
  },
  "serve_args": {
    "quantization": "modelopt",
    "load_format": "fastsafetensors",
    "kv_cache_dtype": "fp8",
    "attention_backend": "flashinfer",
    "moe_backend": "marlin",
    "max_num_batched_tokens": 8192
  },
  "status": "candidate",
  "last_smoke_test": null
}
```

Benchmark specs should describe workload shape: prompt length, output length, request rate, concurrency, repeats, and result location. They should reference the canonical runtime/profile instead of carrying unrelated toolchain decisions inline.

## Workflow

1. Audit existing canonical runtimes before creating anything new.
2. Audit official release binaries, remote multi-platform container manifests, and official packages for the target platform.
3. Stop for explicit approval before any source build or before downloading or running any `community` source.
4. Classify the source as `official`, `community`, or `local`. Record its owner, immutable provenance, and approval evidence in the manifest.
5. Report expected disk impact before creating, replacing, or deleting a runtime.
6. Create new runtimes only under `~/runtimes/<engine>/versions/<runtime-name>/`.
7. Write or update `manifest.json` during setup, not after the fact.
8. Run a smoke test before promoting a runtime.
9. Promote by updating `current` only after the smoke test passes.
10. Mark superseded runtimes as `archived` or `broken` in their manifest.
11. Delete old runtimes, images, caches, or benchmark artifacts only when the user explicitly approves the named cleanup candidates.

Never patch or upgrade a working runtime in place to make a benchmark pass.
Create a versioned candidate, preserve the incumbent, and compare them. If disk
is insufficient, stop and request approval for a specific cleanup plan instead
of deleting the incumbent or another restorable dependency.

Before starting any local inference server, compiler-heavy model load, or
benchmark traffic, also use `$safe-inference-launch`. Do not launch vLLM,
llama.cpp, SGLang, TensorRT-LLM, FlashInfer/modelopt, Ollama, or similar local
serving processes directly.

When promoting a local runtime, install automatic guarded shims for the runtime
entrypoint if possible. For vLLM this means wrapping the promoted executable:

```bash
~/.codex/skills/safe-inference-launch/scripts/install-shims.sh \
  --wrap ~/runtimes/vllm/current/.venv/bin/vllm
```

This protects benchmark scripts that call the runtime by absolute path.

## Smoke Tests

Use the smallest test that proves the runtime can start, serve, and return output without exceeding safety limits.

For vLLM benchmark runtimes:

- verify the executable version;
- verify import paths for key packages;
- verify hardware-specific packages such as FlashInfer cubins;
- run one low-risk request through the intended model;
- record the configured backend and the backend observed in runtime logs;
- fail the smoke test on fallback, emulation, version mismatch, or an unexpected kernel;
- save the exact command, logs, and result in `smoke.json`.

An import, capability probe, available symbol, or successful server startup does
not prove that the requested backend executed. Do not promote a runtime based
only on successful package installation or backend availability checks.

## Safety

- Do not lower memory guards just to get a smoke test to pass.
- Do not start local inference as a fallback when the intended target is a
  remote endpoint or hosted API. Verify the remote target first and report auth
  or availability failures.
- Use a process-group watchdog plus active earlyoom for local large-model
  launches. If those guards are unavailable, refuse the launch or ask before
  continuing.
- Do not create system or user services unless the user explicitly asks for a service.
- Do not treat `~/services` as a runtime location.
- Do not mutate an existing working runtime in place. Create a new versioned runtime and promote it after testing.
- Preserve old runtime manifests when cleaning up so results remain explainable.
