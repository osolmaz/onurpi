# Pi Reviewer implementation plan

## Goal

Build Pi Reviewer as a standalone Pi Factory app in `packages/pi-reviewer/`. Its public interface
will be a normal terminal command:

```bash
pi-reviewer --uncommitted
pi-reviewer --base main
pi-reviewer --commit <sha>
pi-reviewer "focus on cancellation safety"
```

The npm package will be `@osolmaz/pi-reviewer`, with `pi-reviewer` as its binary. The unscoped
`pi-reviewer` npm name is already reserved by another owner. The GitHub repository name
`osolmaz/pi-reviewer` currently has no public repository, but this implementation will remain in the
OnurPi monorepo unless a later task explicitly moves it.

Pi Reviewer will use Pi Factory to resolve its app bundle, generate an isolated Pi configuration,
and prepare the native Pi launch. The reviewer package will own target parsing, review prompts,
read-only inspection policy, structured output, and terminal rendering. It will not register a
global `/review` command in OnurPi.

## User experience

The command will accept the same target forms as standalone `codex review`:

```text
pi-reviewer --uncommitted
pi-reviewer --base <branch>
pi-reviewer --commit <sha> [--title <title>]
pi-reviewer <custom instructions>
```

The review extension will contain no model identifier. Users must set the model externally through
persistent config or a one-run flag. Thinking defaults to `high` unless external config changes it.

```text
pi-reviewer config set model openai-codex/gpt-5.6-terra
pi-reviewer config set thinking high
```

Users can inspect or remove that default and override one run:

```text
pi-reviewer config show
pi-reviewer config reset
pi-reviewer --model openai-codex/gpt-5.6-sol --thinking high --base main
```

Resolution order is command-line override followed by user config. The command fails before
launching Pi when neither supplies a model. A model value always includes its provider so the two
cannot drift apart.

Other app commands will include:

```text
pi-reviewer login [provider]
pi-reviewer models [search]
```

A normal review will run without an interactive Pi TUI and print only the final report to stdout.
Progress and errors will go to stderr. SIGINT will stop the active Pi process and return exit
status 130.

Invalid arguments, missing authentication, unavailable models, malformed output, cancellation or
timeout, and child-process failures will return a nonzero status. A completed review returns zero
even when it contains findings.

## Pi Factory fit

Pi Reviewer is a named standalone Pi application. It needs its own system prompt, tool policy,
extensions, runtime configuration, state directory, and launch command. These are the resources Pi
Factory already packages and resolves.

The boundary will remain clear:

- Pi Factory owns bundle parsing, runtime config generation, installed app state, and native Pi
  launch preparation.
- Pi owns model execution, authentication, provider transport, context files, and extension hooks.
- Pi Reviewer owns review targets, the Codex-derived rubric, read-only inspection rules, output
  validation, and report rendering.

Pi Reviewer should use `createPiLaunchPlan()` and related public Pi Factory APIs. It should not
reproduce Pi Factory's manifest loading or config generation.

## Needed changes in pi-factory

Pi Factory 0.2.0 requires every manifest to define a custom `openai-completions` provider with a
base URL. That model does not cover Pi catalog providers such as `openai-codex`, nor extension
providers such as Hugging Face OAuth. Its launch overrides also lack an explicit ephemeral-session
option and a native Pi subcommand path for app-scoped login.

Add these capabilities to Pi Factory before implementing the reviewer package:

1. Allow a manifest to reference a Pi catalog provider without defining a base URL or replacing its
   model catalog.
2. Allow launch overrides for provider, model, thinking level, and `--no-session`.
3. Add a documented way to prepare the app environment for native Pi commands such as
   `--list-models`; interactive login runs through Pi's `/login` command in the same app profile.
4. Keep existing custom OpenAI-compatible provider manifests working unchanged.

A possible manifest shape is:

```toml
[provider]
id = "openai-codex"
source = "pi"

[model]
id = "gpt-5.6"
```

For `source = "pi"`, generated `models.json` must not replace the provider. Generated settings may
select the provider and model. Authentication remains in Pi Reviewer's own Pi Factory state
directory and is created only through an explicit login. Pi Factory must never copy credentials from
the user's normal Pi profile.

This is a separate change in `/home/onur/repos/pi-factory`. Implementing this plan does not
authorize committing, publishing, or merging that repository. Obtain the applicable repository
approval before making or merging the dependency change.

If Pi cannot load a catalog provider from isolated app state through documented behavior, stop and
report the missing public capability. Do not copy `auth.json`, symlink credential stores, patch Pi,
or read private runtime fields.

## Package layout

Create this independent workspace package:

```text
packages/pi-reviewer/
  AGENTS.md
  LICENSE.codex
  README.md
  UPSTREAM.md
  package.json
  pi-factory.toml
  prompts/review-system.md
  extensions/review-guard.ts
  src/cli.ts
  src/args.ts
  src/app.ts
  src/config.ts
  src/git-target.ts
  src/prompt.ts
  src/pi-events.ts
  src/review-output.ts
  src/render.ts
  src/runner.ts
  test/*.test.ts
  eslint.config.mjs
  tsconfig.json
  vitest.config.ts
  stryker.config.mjs
  slophammer.yml
  scripts/run-slophammer.sh
```

The package will depend on a pinned release of `@osolmaz/pi-factory` that contains the required
catalog-provider support. Keep process and filesystem code at the package boundary. Parse every Pi
JSON event as unknown input before converting it to typed data.

Keep this package out of the root `pi.extensions` manifest. Its binary runs the standalone
application only when the user invokes it.

## App bundle

The bundle will define:

- No shipped model identifier; the CLI supplies the externally configured provider and model for
  each review.
- `high` thinking as the fallback when external config omits the level.
- An isolated state directory under `~/.local/state/pi-reviewer`.
- An isolated Pi session directory, although normal reviews use `--no-session`.
- The pinned supported Pi version.
- A default Pi catalog provider and model.
- The Codex-derived review system prompt.
- The `review-guard.ts` extension.
- The `read`, `bash`, `grep`, `find`, and `ls` tools.
- High thinking by default, with a command-line override.

Keep Pi context-file discovery enabled so applicable `AGENTS.md` files reach the reviewer. Disable
skills and prompt templates plus themes and unrelated extension discovery through native Pi launch
flags. Load only the app bundle's review guard and provider extension when one is required.

Hugging Face support may load the pinned `pi-huggingface-oauth` extension from the package. Unknown
extension-owned providers must fail with a clear message instead of loading the user's global
extension set.

## Review behavior

Use OpenAI Codex commit `fa1d4c40d0e63eef2e0ba8a9e004ccd0a80b77f5` as the behavioral reference.
Record the source files, retrieval date, Apache-2.0 license, and local changes in `UPSTREAM.md`.

Preserve these parts of standalone `codex review`:

- Each command starts a fresh reviewer with no previous conversation.
- Targets cover uncommitted changes, a base branch, one commit, or custom instructions.
- Base review resolves the merge base with `HEAD` before the model starts.
- The reviewer receives a dedicated review rubric and output contract.
- The model inspects the checkout and reports findings without implementing fixes.
- The final result contains findings, an overall correctness verdict, an explanation, and confidence
  scores.
- Failed or malformed output is never presented as a clean review.

Copy only the Codex prompt and schema material needed for this behavior. Preserve its license and
provenance.

## Target resolution

Parse review arguments before launching Pi. Reject unknown flags, mixed targets, repeated target
flags, missing values, empty instructions, and oversized input.

Run Git probes with argument arrays and `shell: false`. For uncommitted review, prompt for staged
and unstaged changes plus untracked files. For base review, resolve `git merge-base HEAD <branch>`
with a bounded timeout and include the SHA in the prompt. For commit review, verify that the object
is a commit and read its title when `--title` is absent.

Never interpolate a branch, SHA, title, or custom instruction into a shell command.

## Read-only policy

The reviewer will receive only `read`, `bash`, `grep`, `find`, and `ls`. The `review-guard.ts`
extension will enforce a strict Bash allowlist through documented `tool_call` interception.

Allow direct inspection commands such as `git status`, `git diff`, `git show`, `git log`,
`git blame`, `git merge-base`, `rg`, `grep`, `find`, `ls`, `pwd`, `cat`, `head`, `tail`, and `wc`.
Block redirection, shell operators, command substitution, interpreters, package managers, mutating
Git operations, external diff helpers, pagers, network clients, and paths outside the checkout.

Use `shell: false` for every host-side process. A model request may access its selected provider,
but review tools must not access the network.

## Pi launch and output

The CLI will load the bundled manifest and ask Pi Factory for a launch plan with these overrides:

```text
cwd = repository root
mode = json
messages = [resolved review prompt]
noSession = true
provider/model/thinking = command overrides or app defaults
```

The reviewer package will execute the returned plan because it needs to parse Pi JSONL
incrementally. It will retain only bounded progress state, usage totals, the final assistant text,
and the latest error. Complete reasoning and tool results will not be retained.

SIGINT and termination must stop the Pi process tree. Use a bounded SIGTERM period followed by
SIGKILL where supported. Add an absolute runtime limit and an inactivity limit. Always remove signal
handlers and timers before returning.

## Structured result

Validate final model output against the Codex review shape:

```text
findings[]
  title
  body
  confidence_score
  priority
  code_location.absolute_file_path
  code_location.line_range.start/end
overall_correctness
overall_explanation
overall_confidence_score
```

Accept one complete JSON object, including an unambiguous object surrounded by incidental text.
Reject missing fields, duplicate objects, invalid priorities, out-of-range confidence scores,
relative paths, nonpositive lines, reversed ranges, empty output, and truncated output.

Render findings in priority order, followed by the verdict and overall confidence. Do not publish
comments, edit files, apply fixes, open pull requests, or select merge actions.

## Authentication and models

`pi-reviewer login` will prepare the same Pi Factory app state used by reviews and invoke Pi's
documented authentication command. Credentials stay in that isolated profile. The command must not
import or copy credentials from normal Pi, OnurPi, Codex, Hugging Face, or another Pi Factory app.

`pi-reviewer models` will use the app profile and Pi's model listing. `--model` selects one listed
model for the current run without changing the app's persistent default.

Persistent user defaults will live at `~/.config/pi-reviewer/config.json`:

```json
{
  "version": 1,
  "model": "openai-codex/gpt-5.6-terra",
  "thinking": "high"
}
```

The file is optional. Validate it strictly, reject unknown fields, write it atomically with
user-only permissions, and preserve no secrets there. `config reset` removes the user override,
after which reviews require `--model` until another model is configured.

The first live verification should use OpenAI Codex. Hugging Face verification follows after the
provider extension works in the isolated app profile. Do not substitute another runtime or provider
when either path fails.

## Tests

Add package tests for:

- Target argument parsing, hostile branch names, quoting, size limits, and mutual exclusion.
- Git resolution with staged files, unstaged files, untracked files, merge bases, detached HEADs,
  missing branches, and invalid commits.
- Codex prompt fixtures and output schema, plus provenance and license checks.
- Pi Factory manifest loading and launch override construction.
- Catalog-provider selection, missing-model failure, user defaults, command-line overrides, and
  ephemeral sessions.
- Strict config parsing, unknown fields, precedence, atomic writes, permissions, show, and reset
  behavior.
- App-scoped login and model-listing launch preparation without credential copies.
- Review guard allow and deny cases, path containment, multiline input, substitutions, plus external
  helper suppression.
- Incremental JSONL parsing across arbitrary chunk boundaries with bounded memory.
- Clean results, P0 through P3 findings, malformed output, duplicate JSON, empty output, truncation,
  plus provider errors.
- Timeouts, SIGINT, child errors, termination escalation, listener cleanup, and orphan prevention.
- End-to-end faux-provider reviews using a fake Pi command and temporary repositories.
- Launch behavior on Linux and macOS plus Windows in CI.

Keep mutation testing configured but manual unless explicitly requested.

## Repository integration

Add `packages/pi-reviewer` to root TypeScript and Vitest coverage. Update Slophammer and Stryker
plus the CI package checks. Update the root README with installation and command examples. Do not
add a root Pi extension entry or edit tracked `settings.json` because the app does not load into
normal OnurPi sessions.

Add an npm Trusted Publishing workflow for `@osolmaz/pi-reviewer` only when publication is
explicitly requested. The workflow must use GitHub Releases, OIDC, provenance, exact tag-to-version
checks, and the package's full quality gates.

## Verification

Before opening an OnurPi pull request, run:

```bash
npm run check --workspace @osolmaz/pi-reviewer
npm run slophammer --workspace @osolmaz/pi-reviewer
npm run check
npm run slophammer
git diff --check
```

Run faux-provider end-to-end tests first. Then run one bounded live `pi-reviewer --base main` review
after authenticating the app profile. Verify the requested provider and model from Pi events.
Confirm that no tracked file changed, no session file was created, and no child process remained.

## Contract impact

- **Session state:** normal reviews use `--no-session` and create no Pi session entries.
- **Other persistent data:** Pi Factory writes generated runtime config under
  `~/.local/state/pi-reviewer`. Pi writes credentials there only after explicit `pi-reviewer login`.
  Pi Reviewer writes optional model and thinking defaults under `~/.config/pi-reviewer/config.json`
  only through `pi-reviewer config set`.
- **Pi internals:** none.
- **Public APIs:** Pi Factory's manifest and launch-plan APIs, Pi's native CLI modes and
  authentication commands, and the documented extension `tool_call` hook.

## Acceptance criteria

The work is complete when `pi-reviewer --base main` runs a fresh isolated Pi review against the
merge-base diff using the model selected in external config, honors repository instructions, permits
only guarded read-only inspection, validates Codex-shaped P0 through P3 output, and exits without
changing the checkout or writing a session. `openai-codex/gpt-5.6-terra` at `high` thinking is the
primary verification configuration, while one-run overrides must select another valid model without
editing the bundle or extension.

Failures in authentication, target resolution, model execution, output parsing, cancellation, or
process cleanup must return a nonzero status and must never produce a clean verdict.
