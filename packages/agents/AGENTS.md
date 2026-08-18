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

## Remote store reuse policy

- Before creating any GitHub repository, Hugging Face repository or Dataset, Bucket, index, artifact
  store, or coordination store, inventory existing stores that can serve the same purpose.
- Reuse the canonical existing store. Do not create a project-specific duplicate to solve an access,
  privacy, naming, or migration problem.
- An access failure does not authorize a replacement store or a visibility change.
- If no suitable store exists, report the proposed name, purpose, owner, visibility, retention
  policy, and rejected alternatives. Get explicit user approval before creation.
- Default an approved new benchmark store to private and verify its privacy immediately after
  creation.
- `osolmaz/benchmark-run-index` is the canonical Hugging Face Dataset for benchmark publication
  indexes. Do not create another benchmark index Dataset unless the user explicitly approves it.

## Personal agent resources

- Repository: https://github.com/osolmaz/onurpi.
- The private xTap store is the Hugging Face dataset `osolmaz/xtap-pool-data`. It contains the
  X/Twitter posts Onur sees while browsing when xTap capture and sync are active. Use it as a source
  for recent posts and latest information, while treating it as a personal observed feed rather than
  an exhaustive index of X.
- Use the `browse-x-posts` skill when asked to browse, search, identify, summarize, or verify
  remembered X/Twitter posts or tweets, or when recent social posts could inform a
  latest-information request.
- Personal agent skills usually live in `packages/agents/skills/<skill-name>/SKILL.md` in the OnurPi
  repository. The `paid-compute-launch` skill is an exception. Its source lives at
  `.agents/skills/paid-compute-launch/` in the `osolmaz/control-plane` repository.
- Treat an unqualified request to add, update, or remove a skill as a change to the personal skills
  in the OnurPi repository, except for a skill with an explicitly recorded source repository. Treat
  an unqualified request to add or change `AGENTS.md` as a change to `packages/agents/AGENTS.md`.
  Use another repository when the user names that repository or clearly requests project-local
  instructions.
- After changing personal skills or `packages/agents/AGENTS.md`, verify the change and run
  `npm run agents:sync` from the OnurPi repository. Do not edit the tools repository or installed
  harness copies for these requests.
- `npm run agents:sync` mirrors personal skills into Codex, Claude Code, and Cursor. It also mirrors
  global instructions into those harnesses and Pi.
- To update local agent instructions or personal skills, pull the latest OnurPi version, then run
  `npm run agents:sync`.
- Use the `pi-coding-agent` skill for any task involving Pi, including its extensions, packages,
  skills, themes, TUI, SDK, models, providers, configuration, or local state.
- Use the `extending-pi` skill alongside `pi-coding-agent` before proposing, designing,
  implementing, reviewing, or debugging any change to Pi behavior. This includes deciding between an
  extension and Pi core, and requests for elegant, long-term, production-ready, ideal, or holy-grail
  Pi solutions.
- If a skill is referred to but is not installed in the active skill list, check
  `packages/agents/skills/` and the recorded external source repository before treating it as
  missing.
- Edit personal skill sources under `packages/agents/skills/`, except for skills with an explicitly
  recorded source repository. Do not hand-edit copied installations under `$CODEX_HOME/skills`,
  `~/.agents/skills`, `~/.codex/skills`, `~/.claude/skills`, `~/.cursor/skills`, or OpenClaw agent
  runtime mirrors. Pi loads OnurPi skills directly from the package. Run `./control sync-skills` in
  the control-plane repository after changing a control-plane-owned skill.
- Use the `manage-runtimes` skill before creating, updating, promoting, auditing, or deleting local
  inference runtimes.
- Do not create ad hoc vLLM, SGLang, llama.cpp, TensorRT-LLM, or similar runtime environments under
  `~/scratch`, `~/services`, repos, or project-local `.venv` directories. Canonical runtimes belong
  under `~/runtimes/<engine>/`.

## xTap ecosystem

- `xtap-pool` (`~/repos/xtap-pool`, public: `osolmaz/xtap-pool`): vendored xTap extension + ingest
  Space + tweet explorer. Captured tweets are batched to
  `https://osolmaz-xtap-pool.hf.space/api/ingest` with a per-user bearer token from the Space's
  `/connect` page; the Space dedups, attributes, and commits to the private HF dataset
  `osolmaz/xtap-pool-data` (durable record).
- `xtap-sync` (`~/repos/xtap-sync`, public: `osolmaz/xtap-sync`): Go utility that dedups and
  normalizes local xTap JSONL exports into the private archive repo `osolmaz/xtap-store`
  (`~/repos/xtap-store`, `data/tweets/YYYY/MM/`). Daemon config: `~/.config/xtap-sync/config.json`;
  pushes over existing local git auth.
- The `dutifuldev` org is gone; these repos now live under `osolmaz`.
- Pool token, Space variables, dataset tokens, and xtap-sync auth are credentials: never print or
  copy them; use only in place.

## Credential handling policy

- Never copy a credential from one store to another — local token files, agent configs, Space or
  repo secrets, CI variables, `.env` files, other machines — without the user's explicit approval
  for that specific copy, naming the source and the destination.
- Using a locally configured credential in place for its normal purpose (`gh`/`hf` CLI calls, git
  pushes over existing auth) is fine; persisting it anywhere new is not.
- When a service needs a credential, ask which one to use. Prefer purpose-scoped tokens over broad
  account tokens.
- Never print secret values into logs, chat output, commits, or files. Use masked previews
  (first/last characters) when identification is needed.
- If a credential was persisted somewhere without approval, disclose it immediately, overwrite or
  remove it, and recommend rotating the exposed credential.

## Runtime repository

- `~/runtimes` is the working tree for the private repository `https://github.com/osolmaz/runtimes`.
- Track lightweight runtime manifests, serving profiles, setup recipes, benchmark protocols/specs,
  and concise failure summaries there. Installed environments, binaries, source checkouts, model
  files, caches, logs, telemetry, raw benchmark data, databases, and reports must remain ignored.
- Before changing tracked runtime control files, update `~/runtimes` with `git pull --ff-only`.
  After an intentional change, run `scripts/check-repo.sh`, commit only the intended files with a
  Conventional Commit message, and push `origin/main` in the same task unless the user explicitly
  requests local-only work.
- Never use `git add -f` in `~/runtimes`. If a new lightweight control-file type should be tracked,
  extend the narrow `.gitignore` allowlist and repository checks first.
- Never run or resume a benchmark recipe from a directory containing `INVALID.json`.

## Repo maintenance conventions

- Unless the user specifies a different location, clone external repositories into `~/repos`.
- Use the repository name as the default checkout directory under `~/repos`, for example
  `~/repos/autoresearch` for `karpathy/autoresearch`.
- Clone repositories from the `openclaw` GitHub organization into `~/oc` instead, for example
  `~/oc/openclaw` for `openclaw/openclaw` and `~/oc/clawhub` for `openclaw/clawhub`.
- Clone repositories from the Hugging Face GitHub organization into `~/hf` instead, for example
  `~/hf/transformers` for `huggingface/transformers`.
- Create Git worktrees in a `<repo_name>-worktrees` directory next to the main checkout, for example
  `~/oc/openclaw-worktrees/86504` for `~/oc/openclaw`. Do not create worktrees inside the main
  checkout or as scattered sibling directories unless the user asks for a different layout.
- After a pull request is merged, or when work associated with a local Git worktree is otherwise
  complete, remove that worktree, prune stale worktree metadata, and delete its local branch when it
  is no longer needed.
- Before cloning, check whether the target directory already exists. If it is already the requested
  repository, update it with `git pull --ff-only` instead of recloning.
- Whenever creating a new repository, after initializing it, run
  `npx github-sane-defaults@latest apply` in the repository to apply the standard GitHub defaults.
- When creating or managing a project in a language supported by Slophammer, apply Slophammer
  standards and add the relevant checker/config/CI so the quality gate is enforceable locally and in
  CI.
- Do not place unrelated external repository clones inside the OnurPi repository unless the user
  explicitly asks for vendored or source-controlled contents.
- Keep local scratch work, downloaded papers, generated experiment outputs, and temporary datasets
  outside the OnurPi repository unless the user explicitly asks to track them there.
