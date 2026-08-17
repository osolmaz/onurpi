---
name: hf-inference-endpoints
description: Use when creating, updating, resuming, pausing, deleting, inspecting, smoke-testing, profiling, or benchmarking Hugging Face Inference Endpoints. Enforces remote-only execution, reproducible endpoint configuration, cost-aware lifecycle management, and mandatory pause-and-verify cleanup whenever an endpoint is no longer actively being used.
---

# HF Inference Endpoints

Manage Hugging Face Inference Endpoints as temporary remote compute. Keep exact
deployment details and benchmark evidence, and leave unused endpoints paused.

## Core Rules

- Use the authenticated `hf endpoints` CLI. Read credentials from the existing
  Hugging Face login or environment; never print or persist tokens in notes.
- Do not load or serve the model locally when the requested target is an
  Inference Endpoint. A local client sending requests to the endpoint is fine.
- Inspect existing endpoints before creating one. Reuse a compatible paused
  endpoint when practical, and avoid duplicate billable deployments.
- Record the namespace, endpoint name and URL, provider, region, hardware,
  replica bounds, model revision, container image, serving arguments, and
  reported hourly cost before benchmarking.
- Treat `initializing`, `updating`, and `running` endpoints as potentially
  billable. Resume an endpoint only immediately before active work.
- Never change or pause unrelated endpoints unless the user asks.

## Lifecycle

### Inspect

```bash
hf endpoints list --namespace NAMESPACE
hf endpoints describe NAME --namespace NAMESPACE --format json
```

Confirm the endpoint identity and current state before mutation. For an active
endpoint, verify health and make a minimal inference request before starting a
large profile or benchmark. Preserve representative response bodies and error
details without exposing credentials.

### Create Or Update

Pin model and runtime revisions when the API supports it. Choose hardware and
serving parameters from measured workload requirements rather than the GPU name
alone. Keep endpoint capacity limits separate from client-side request, task,
and agent concurrency.

After creation or update, wait for the endpoint to become ready, then verify:

1. The reported model and runtime configuration match the request.
2. Health and inference requests return successfully.
3. The response contains expected text, usage, and tool-call fields.
4. Logs and benchmark output contain no hidden 4xx/5xx, timeout, truncation, or
   agent-exit errors.

### Resume

```bash
hf endpoints resume NAME --namespace NAMESPACE --format json
```

Resume only when work is ready to start. Wait for a ready replica and a passing
health/inference probe before sending benchmark traffic.

### Down Unused Endpoints

Pause is the default meaning of "down" because it stops replicas while
preserving endpoint configuration:

```bash
hf endpoints pause NAME --namespace NAMESPACE --format json
hf endpoints describe NAME --namespace NAMESPACE --format json
```

Whenever an endpoint is no longer actively being used, pause it immediately.
Do not leave it running merely because more work may happen later. This cleanup
applies after successful work and after errors, interruption, cancellation, or
an aborted benchmark.

Before the final response, pause every endpoint created or resumed during the
task that is no longer serving a verified active external job. Verify:

```text
status.state = paused
readyReplica = 0
```

Also record `targetReplica`. A paused endpoint can retain a nonzero target from
its configured minimum even though it has no ready replica; do not mistake that
retained configuration value for a running replica. If the state is not
`paused` or `readyReplica` is nonzero, inspect and retry cleanup.

If pause fails, inspect the endpoint, retry, and report the remaining active
state explicitly. Never silently leave a billable endpoint running.

Only leave an endpoint running when the user explicitly asks, or when a
currently active external job is verified to still depend on it. State that
exception and the endpoint identity in the final response.

Scale-to-zero is useful for idle autoscaling but does not replace immediate
pause cleanup. Delete an endpoint only when the user explicitly requests it, or
when it was explicitly designated disposable and its reproducibility details
have been preserved.

## Benchmarking

- Start with a smoke request, then ramp concurrency in measured steps.
- Capture request count, concurrency, prompt/output lengths, TTFT, TPOT or ITL,
  per-request decode rate, aggregate token throughput, latency percentiles,
  errors, and endpoint replica state.
- Treat successful HTTP status alone as insufficient. Validate output content,
  token accounting, task completion, and endpoint logs.
- Stop the ramp when goodput falls, latency violates the target, or errors
  appear. Diagnose capacity, queueing, runtime, and client limits separately.
- Pause the endpoint as soon as profiling or benchmarking finishes.

## Final Report

Report the endpoint name, final state, and whether any ready or target replica
remains. Include the exact configuration and result locations needed to
reproduce the work, plus any errors or unverified assumptions.
