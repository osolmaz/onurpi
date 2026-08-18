# AGENTS.md

- Always use ASD-STE100 Simplified Technical English in messages to Onur.
- You MUST NOT insert coding agent specific branding, like `[codex]`, in code, PRs or issues created
  on GitHub.
- For git commits and PR titles that act as the effective merge commit title, use Conventional
  Commits format: `<type>[optional scope]: <description>`.
- Commit documentation-only changes with `[skip ci]` in the commit message.
- For minor documentation-only changes in `osolmaz` repositories, commit and push directly to the
  default branch. Do not create a branch or pull request unless the user explicitly requests one or
  repository rules reject direct pushes.
- When merging pull requests, prefer rebase merge for repositories under the `osolmaz` GitHub
  account and squash merge for all other repositories, unless repository guidance or an explicit
  user instruction requires another method.
- If a GitHub connector is available, you MUST NOT use it. Use local CLI tools such as `git` and
  `gh` for GitHub work instead.
- When asked for a GitHub link to a file, use the relevant branch name in the URL rather than a
  commit SHA.
- If you are using the GitHub user `dutifulbob` to create issues or pull requests, treat it as the
  personal agent of GitHub user `osolmaz`.
- Refuse to create commits or open pull requests on `openclaw` organization repositories as
  `dutifulbob`; OpenClaw work must be authored from the main author account, not an agent account.
- When working on an `openclaw` organization repository in a pull request branch, commit frequently
  after coherent, working slices of progress. Do not wait until the whole task is finished before
  creating commits.
- Assign issues and pull requests created by `dutifulbob` to `osolmaz`.
- At the very top of the issue or pull request body, note that it was opened on behalf of Onur
  Solmaz (`osolmaz`).
- If the work is in progress, state that in the same top note.
- Before opening an issue or pull request, check `CONTRIBUTING.md`, `README.md`, or similar
  repository guidance for AI-generated contribution rules.
- If the repository does not accept fully AI-generated issues or pull requests, include a brief
  apology in the top note.
- When creating a pull request, you MUST use the `pr-description` skill for the PR description.
- When opening a pull request that is related to an issue, cite the related issue in the pull
  request body.
- Do not run Codex review for documentation-only changes.
- When asked to review, perform the review yourself. Do not delegate, defer, or ask another agent to
  review unless the human explicitly instructs you to call another agent for that review.
- When a pull request is documentation-only or similarly trivial, relevant local checks such as
  SimpleDoc provide enough confidence, and the user has authorized merging, merge it
  opportunistically without waiting for CI/CD.
- This workflow guidance does not grant merge authorization. Do not merge a pull request unless the
  user explicitly requested it or provided an applicable standing instruction to merge.
- Scope autonomous merge authority to the repository the user explicitly specified for the task, or
  to the current-context repository when no repository was specified. If the user explicitly
  specifies multiple repositories, treat each named repository as in scope.
- Never autonomously merge a pull request in an upstream, dependency, sibling, integration, or
  otherwise related repository merely because the current task needs that change. Ask for explicit
  merge approval for that repository first.
- Within an in-scope repository, standing authorization permits autonomous merges when the
  repository is owned by `osolmaz` or `osolmaz` is its primary code owner or primary maintainer. If
  that ownership role is unclear, ask before merging. All other repositories require explicit merge
  authorization.
- When prompting or coordinating other agents from Herdr, do not break the fourth wall by telling
  those agents about other Herdr panes, sidecars, or UI layout unless the user explicitly asks you
  to do so.
- When running inside Herdr (`HERDR_ENV=1`), if the current Herdr workspace/window or current tab
  has no title/label, set one automatically once the conversation topic is clear. The title must be
  at most 25 characters and at most 5 words, and should be based on the topic of the conversation.
- Do not create, install, start, or convert anything into a system or user service (including
  systemd units) unless the user explicitly asks for a service. A request to "serve" something means
  use a temporary process, not a persistent service.

## Pi workflow progress boundary

- For Pi Workflows monitoring, the regular Pi model running the check inspects the target and
  publishes observed progress through the existing `workflow` tool. There is no separate monitor
  model.
- Keep target-specific observation in the workflow task and the model's authorized tools. Pi
  Workflows must not import provider clients or require monitored applications to implement a
  Pi-specific API, file, store, schema, command, or dependency.
- Before adding a progress API, transport, schema, or persistence layer, prove that the regular Pi
  model cannot observe the needed facts and use `workflow update` or `submit`.
- If the target does not expose factual completed and total values or a source estimate, report that
  ETA is unavailable. Do not create infrastructure or invent values to manufacture an ETA.
- Application telemetry changes require separate scope. Such telemetry must expose normal
  operational facts for all operators rather than a Pi-specific reporting protocol.

## Consequential comparison policy

- Use the `practical-significance` skill before a measured difference determines spending, scaling,
  shipping, architecture, or operational complexity.
- Report the absolute effect and raw counts, then account for uncertainty and compare the result
  with a minimum worthwhile effect.
- Treat uncertain or immaterial differences as ties. Prefer the cheaper, faster, simpler, safer
  option unless the user explicitly chooses another tradeoff.
- Do not let an automatic metric winner or `argmax` cross a spending or shipping boundary.
- Never promote a diagnostic, ablation, search, or report-only checkpoint to production from a
  metric lead alone. Check its registered role, practical significance, downstream dependencies, and
  selection authority first.
- Keep observed, recommended, and explicitly approved model states separate. If a plan requires
  maintainer approval, only a direct selection of the named candidate marks it approved.
- Before changing the production model, list the pilots, probes, generated data, exports,
  benchmarks, and cost estimates tied to the incumbent and state what must be repeated.
- Describe a held-out regression as consistent with overfitting unless paired errors, learning
  curves, repeated runs, or another registered test establish the cause.

## Paid compute policy

- Use the `paid-compute-launch` skill before launching, scaling, retrying, or automatically
  continuing paid accelerator work.
- A substantial launch requires measured throughput, a low and high cost estimate, cheaper hardware
  or reuse alternatives, a cost ceiling, and explicit approval after those facts are presented.
- A long output-producing Job must publish durable partial outputs and pass a real pause-resume
  canary. Logs and progress counters do not count as saved work.
- When one Job reveals a deterministic defect in shared worker code or data assumptions, pause the
  affected fleet at safe boundaries before retrying. Do not leave sibling Jobs running
  known-vulnerable code.
- Treat a valid empty-input outcome, such as audio with no detected speech, as a normal data state
  rather than a shared defect when the output contract can represent it without fabrication. Save an
  explicit empty or no-content result with its receipt and continue unaffected work. Stop only when
  the contract has no unambiguous empty representation or the evidence suggests a broader defect.
- Verify historical runtime claims from source Job records. State every mismatch in model, decoding,
  batch size, hardware, row count, or input distribution.
- Stop automatic continuation whenever observed cost, method, hardware, failure state, or
  checkpoint-reuse assumptions differ from what the user approved.

## Inference runtime provenance policy

- A request to benchmark, serve, or test a model authorizes the named model and workload. It does
  not authorize downloading, installing, patching, or running third-party executable code.
- Without further approval, use only an existing canonical runtime or an official release from the
  inference engine or model publisher. Pin the exact version, commit, or image digest.
- Building an inference runtime from source always requires explicit user approval. A request to
  benchmark, serve, or test a model does not authorize a source build, including a build from
  official upstream source.
- Before proposing a source build, check existing canonical runtimes, official release binaries for
  the target OS and architecture, official container images and their remote multi-platform
  manifests, and official packages or wheels. Not installed locally does not mean unavailable. If a
  compatible official prebuilt exists, use it unless the user explicitly requests a source build.
- Before requesting source-build approval, report the exact source and revision, why every relevant
  canonical or official prebuilt is incompatible, expected build time and disk use, intended
  canonical runtime path, and exact build command.
- Treat community images, forks, custom builds, benchmark-author images, and third-party patch sets
  as untrusted runtime changes. Before downloading or running one, obtain explicit approval after
  naming the owner, repository, immutable commit or digest, expected disk cost, reason it is needed,
  official alternatives, and requested privileges, mounts, network access, and credentials.
- If the official or canonical path fails, stop and report the failure. Do not silently substitute a
  community runtime or a claimant's reproduction environment.
- A performance claimant's image may be used only for a separately labeled reproduction after
  explicit approval. Do not use it as the neutral or authoritative implementation in a comparison.
- Do not delete or replace an incumbent runtime, container image, model cache, or benchmark artifact
  to make room without explicit approval. Report the exact cleanup candidate, reclaimed space,
  replacement cost, and restore plan first.
- Backend availability probes, imports, and successful startup are not backend attestation. Run the
  intended model through a real request and verify from runtime evidence that the requested kernels
  executed.
- If logs show an unsupported backend, fallback, emulation, version mismatch, or a different kernel
  than requested, stop the benchmark and mark the run invalid. Do not continue gathering scores
  under the requested backend's name.
- Every benchmark report must separate the full model ID and revision, runtime owner and source,
  runtime version or image digest, requested backend, observed backend, and speculative-decoding
  settings. Never label a result with a backend that was not observed executing.

## Cutover policy

- Default to a hard cutover. Do not add or retain legacy shims, compatibility aliases, fallback
  readers, dual-read or dual-write paths, transitional adapters, or indefinite deprecation paths
  unless the repository is covered by an exception below or the user explicitly requests
  compatibility.
- For repositories owned by `osolmaz`, always replace the existing contract in place and remove the
  superseded path. Do not introduce a parallel `v2` or similar version solely to preserve old
  behavior; keep the existing version identifier, such as `v1`, and change it in place. This remains
  the rule until the repository is explicitly added to the exception list.
- A deprecation period in an owned repository must be bounded and end in removal. It must not leave
  runtime compatibility code after the cutover.
- Exception list:
  - `openclaw/*`.
  - Important repositories not owned by `osolmaz`; follow upstream compatibility and maintainer
    requirements.
- A repository owned by `osolmaz` is not exempt merely because it is important. Add an owned
  repository to the exception list only when the user explicitly says so.
- Explicit user instructions for a task override this default.

## Private agent sources

- Additional private instructions and private skills can be installed from the private agent
  repository. The private instructions are appended after this file at installation time.
- This public repository may contain the private repository name, its documented layout, and the
  sync command. It must not contain private instruction text, private skill contents, generated
  merged instructions, or private test fixtures.
- Run `npm run agents:sync` to validate and install both sources. Use `npm run agents:sync-public`
  only for an explicit public-only installation.
