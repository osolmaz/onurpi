---
title: Command Guard plan
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-09-02
tags: [pi, extension, shell, safety]
---

# Command Guard plan

## Implementation status

Implemented on `feat/command-guard`. The implementation keeps the extension-only design. It adds no
Pi core changes and uses no Pi private APIs.

The implemented policy has no confirmation gate. Exact destructive targets outside the protected
paths run normally. Protected or uncertain targets are blocked.

The final Unified Exec design is stronger than the first event-only draft. Unified Exec now exposes
`registerFinalCommandPolicy()`. It rebuilds frozen, synchronous policy requests from the actual
spawn arguments or input bytes after all shared-event listeners and immediately before process spawn
or nonempty input. Shared events remain public for normal integrations, but Command Guard does not
depend on listener order for its final check.

The official Bash grammar uses the WebAssembly path. PowerShell uses its official parser in a
short-lived `-NoProfile -NonInteractive` process only after a destructive lexical check. If that
parser is unavailable or fails, the possible destructive command is blocked.

The implementation keeps one parser instance but does not cache parsed commands. Parsed words bind
to environment values, and the measured warm path is already much faster than the target. A local
run classified 10,000 short commands with a 0.045 ms p95 and 0.131 ms p99. The 8 KiB corpus had a
0.330 ms p95. The 64 KiB corpus had a 2.718 ms p95 and 3.918 ms p99. Parser initialization took
19.966 ms. Avoiding a source cache removes invalidation and memory risks without a practical speed
cost.

Linux mount checks read `/proc/self/mountinfo`, including bind mounts and escaped mount paths. Other
systems use root parsing and filesystem device identity. The final target check still cannot close
the small operating-system race between identity verification and the child opening a path; that
requires a sandbox or native filesystem boundary.

## Purpose

A cleanup command set `HOME` for one command and later ran `rm -rf "$HOME"`. The temporary value no
longer applied, so the shell could expand `HOME` to the real home directory. A routine cleanup must
not be able to delete a home directory, filesystem root, mount root, or the directory in which Pi is
working.

Build `pi-command-guard` as a project-independent Pi extension. It will check commands once, just
before execution, and stop dangerous filesystem operations before the shell starts. It will use the
real command, shell, working directory, and child environment available at that point. It will not
copy projects, watch every filesystem call, run a permanent service, or change Pi.

## User requirements

- Work in every directory. Do not depend on a repository root, project layout, language, or build
  system.
- Add little delay to normal commands.
- Catch dangerous commands before they run.
- Cover Pi's built-in shell tools, `!` commands, unified-exec, and commands sent to managed
  sessions.
- Inspect the last command, shell, working directory, and environment that the extension can see.
- Treat unclear shell expansion as unsafe instead of guessing.
- Allow exact destructive targets outside the protected paths without a prompt.
- Never let model or project configuration authorize deletion of protected roots.
- Fail closed when parsing or adapter coverage is unavailable.
- Use an independent OnurPi package. Do not change Pi core or use Pi private APIs.

## Decision

Create `packages/command-guard` as a private package named `@onurpi/command-guard`. Its display name
will be `pi-command-guard`.

The package has one pure policy engine and small adapters for each command route. The policy engine
parses shell syntax, finds destructive operations, resolves targets that can be known without
running the command, and returns one of three decisions:

| Decision  | Meaning                                                              | Result                                          |
| --------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| `allow`   | The command is safe, or each destructive target is exact and allowed | Run immediately without a prompt                |
| `rewrite` | A target or operation depends on uncertain shell behavior            | Block and tell the model to use literal targets |
| `deny`    | The target is protected or the command cannot be checked safely      | Block                                           |

This is a broader form of Codex's command check. Codex added Tree-sitter-based detection for literal
forced `rm` calls in [PR #33464](https://github.com/openai/codex/pull/33464). Its regression test
includes the reported `HOME=$(mktemp -d) ...; rm -rf "$HOME"` pattern. The OnurPi policy will cover
more deletion forms, use path rules, and reject unresolved destructive targets. It will not claim to
see deletion hidden inside an arbitrary binary.

## Public Pi API

The installed public API is sufficient with one limitation: Pi can stop model tool calls before
execution, but it does not expose filesystem calls made inside an arbitrary process.

The extension will use these documented APIs:

- `pi.on("tool_call", ...)` and `isToolCallEventType()` to check and block model tool calls.
- `pi.registerTool()` with the same name as a built-in tool to override `bash` and `powershell` when
  those tools are active.
- `createBashToolDefinition()`, `createPowerShellToolDefinition()`, `BashOperations`, and their
  PowerShell counterparts to keep Pi's normal execution and rendering while adding a final guard.
- `pi.on("user_bash", ...)` with guarded local operations for `!` and `!!` commands.
- Unified Exec's public `registerFinalCommandPolicy()` registry for the last pre-spawn and pre-input
  checks, after public event listeners.
- `pi.getActiveTools()`, `pi.getAllTools()`, and `pi.setActiveTools()` to check adapter coverage and
  disable command routes that have no final guard.
- `tool_execution_end` and `session_shutdown` to clear in-memory final checks and listeners.

Public Pi references:

- [Extension events and `tool_call`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md#tool_call)
- [Built-in tool overrides](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md#overriding-built-in-tools)
- [Remote operations and shell spawn hooks](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md#remote-execution)
- [Pi security boundary](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/security.md)

No Pi source, prototype, private class, or session schema will change. If a tool cannot be guarded
through a documented final adapter, the package will disable or block that tool instead of patching
Pi.

## Safety rules

### Commands covered

The first release will recognize these direct operations and their nested forms:

- `rm`, `unlink`, `rmdir`, and `shred`;
- `find -delete`, `find -exec`, and `find -execdir`;
- `xargs` calls that invoke another covered command;
- `rsync --delete`, `--delete-before`, `--delete-during`, `--delete-delay`, and `--delete-after`;
- `git clean`, `git reset --hard`, destructive `git restore`, and destructive `git checkout` forms;
- shell truncation and replacement through `truncate`, destructive `dd` output, and redirection that
  empties an existing file;
- PowerShell `Remove-Item`, `Clear-Content`, and their standard aliases;
- Windows `del`, `erase`, `rd`, and `rmdir`;
- nested `sh`, `bash`, `zsh`, `dash`, `env`, `sudo`, `command`, and `busybox` wrappers.

Option order, short option groups, long options, `--`, pipelines, command lists, loops, conditions,
subshells, traps, and nested shell strings must not hide a covered command.

The policy will keep command families in separate tables with focused tests. Adding a command family
will require a parser rule, path rule, decision rule, user message, and regression test.

### Command parsing

Use the official Tree-sitter Bash grammar instead of regular expressions as the main parser. Pin the
parser runtime and grammar to exact releases and record their source, license, hashes, and reviewed
files in `UPSTREAM.md`.

The implementation must avoid a native build during package installation. The first implementation
step will compare the official WebAssembly and prebuilt Node bindings on Linux, macOS, and Windows.
Use the official WebAssembly grammar if it passes the compatibility and performance gates. Stop and
record a blocker if neither official path works on all supported systems; do not write a partial
shell parser as a fallback.

Initialize the parser once per Pi process. Parse every command through bounded input and nesting
limits. Reject commands that exceed any limit instead of truncating them:

- 128 KiB maximum command text;
- eight nested shell or wrapper levels;
- 1,024 extracted simple commands;
- 256 destructive targets.

Tree-sitter syntax errors are unsafe when the source contains a possible destructive token. A syntax
error with no destructive token may pass only when the lexical precheck can prove that no covered
command name or shell launcher occurs. Tests must show that comments and quoted text do not create
false destructive matches.

For PowerShell, use its official parser in a short-lived, non-interactive helper only after a cheap
lexical check finds a possible destructive command. Pass source through standard input, return
bounded JSON, and never evaluate the source. If the official parser is missing or fails, block the
possible destructive command. Direct `cmd.exe` forms will use a small conservative tokenizer with
strict quoting tests.

### Target resolution

Target resolution must not run shell code.

For each destructive operand:

1. Apply the command's documented option rules.
2. Resolve a relative literal against the final working directory.
3. Resolve a fixed environment variable only when the full parsed script does not assign, unset,
   export, read, or evaluate that variable.
4. Normalize `.` and `..` without crossing a filesystem root.
5. Use `realpath` for an existing target.
6. For a missing target, resolve the nearest existing ancestor and append the remaining normalized
   components.
7. Record the canonical target and the filesystem object identity used for the final check.
8. Recheck the target immediately before spawn. Any drift invalidates the final check and blocks the
   call.

The following forms return `rewrite` because the target is not known before execution:

- command, process, or arithmetic substitution;
- globbing or brace expansion;
- tilde expansion that cannot be tied to the child environment;
- a variable changed anywhere relevant in the script;
- `eval`, aliases, functions, indirect expansion, namerefs, or dynamically built command names;
- an encoded nested command that cannot be decoded with exact documented rules;
- a target split across interactive terminal writes.

The incident command is blocked even if scope analysis is incomplete. `HOME` is assigned in the same
script and later used by a recursive deletion, so the target is not eligible to run. A safe retry
must first obtain the target through a non-destructive command and then submit a literal canonical
path.

### Critical targets

Return `deny` when any canonical target is:

- an empty path;
- a filesystem, drive, or UNC share root;
- the user's home directory itself;
- a mount root;
- the current Pi working directory itself;
- an ancestor of the home directory or current working directory;
- a path whose root, mount, symlink, junction, or case identity cannot be determined;
- a target changed between the first check and final execution.

A descendant of the home directory or current working directory is not denied only because of its
location. An exact target in such a descendant can run without a prompt. This keeps the policy
independent of projects while protecting whole-tree deletion.

Mount detection will use filesystem identity while walking existing ancestors. Linux may also read
`/proc/self/mountinfo`. Windows will handle drive and UNC roots explicitly. Missing or inconsistent
platform evidence returns `deny` for a target that could be a root.

### Final execution check

Every exact destructive operation outside the protected paths returns `allow` without a prompt. A
one-use fingerprint binds that result to:

- tool call or command nonce;
- exact command bytes;
- resolved shell and working directory;
- referenced child environment values;
- canonical target list and object identities;
- policy version.

Any change blocks the call. The final check expires after 60 seconds or when the tool call ends,
whichever comes first. Parallel calls keep separate records. Reload, session change, or shutdown
clears all pending checks.

There is no confirmation gate, model-callable bypass, `allow always`, environment-variable disable
switch, or project setting that weakens the policy.

## Execution adapters

### Built-in Bash and PowerShell

Register guarded replacements with the same built-in names. Preserve Pi's schemas, prompt text,
renderers, result shapes, cancellation, timeout behavior, output limits, and session environment.

The wrapper will make the command decision in its `execute` path. A guarded operations object will
recompute and compare the fingerprint immediately before delegating to Pi's local shell operations.
This final check prevents a later `tool_call` handler from changing an allowed command.

The tools may remain inactive when unified-exec disables built-in Bash. They still need full tests
so `--keep-builtin-bash` cannot bypass the policy.

### User shell commands

Handle `user_bash` and return guarded local operations. Use an in-memory nonce because user shell
events do not have a model tool call ID. Preserve normal `!` and `!!` result behavior.

A direct human command uses the same rules without a prompt. Protected targets remain blocked; the
user can leave Pi and use a separate terminal when they deliberately need an operation that the
guard forbids.

### Unified Exec

Keep `@onurpi/unified-exec` as the process owner. Extend its public integration events in place:

- Add the originating `toolCallId` and immutable invocation ID to `unified-exec:before-spawn`.
- Add `unified-exec:before-input` immediately before nonempty `write_stdin` bytes are delivered.
- Include the session ID, original command, shell, cwd, tty mode, decoded input bytes, and tool call
  ID in the input event.
- Give both events a documented `reject(error)` method.
- Add `registerFinalCommandPolicy()` as a deny-only public registry. Run it on frozen snapshots
  after event listeners and immediately before spawn or input.
- Keep final checks synchronous. The earlier `tool_call` handler records the allowed fingerprint,
  and the final policy verifies it.

Update the existing event contract in place. Do not add a parallel version, compatibility reader, or
second event name. Unified-exec and Command Guard are private alpha packages and will ship together.

Empty `write_stdin` polls remain allowed. Control-only input such as interrupt or end-of-file
remains allowed after exact byte classification. Nonempty input to a shell, REPL, debugger command
prompt, SSH session, or unknown interactive process returns `rewrite` or `deny`; terminal editing
and split writes make safe command reconstruction impossible. Known non-command input protocols need
an explicit tested adapter before they can pass.

### Other custom tools

Create a small adapter registry keyed by tool name. Each adapter declares:

- where command text, cwd, shell, and environment come from;
- whether it has a final pre-execution event;
- whether it can accept later input;
- how it rejects execution.

At session start and before each agent turn, compare active tools with the registry. Known
non-command tools pass. A command-capable tool without a final adapter is removed from the active
set and blocked again in `tool_call` if another extension re-enables it.

Do not infer safety from a tool name alone. New command tools must add an adapter and tests before
OnurPi activates them.

## Package layout

Implementation will create:

```text
packages/command-guard/
├── AGENTS.md
├── README.md
├── UPSTREAM.md
├── eslint.config.mjs
├── index.ts
├── package.json
├── slophammer.yml
├── stryker.config.mjs
├── tsconfig.json
├── vitest.config.ts
├── scripts/
│   └── run-slophammer.sh
├── src/
│   ├── adapters.ts
│   ├── execution-check.ts
│   ├── bash-parser.ts
│   ├── classifier.ts
│   ├── limits.ts
│   ├── path-policy.ts
│   ├── policy.ts
│   ├── powershell-parser.ts
│   ├── targets.ts
│   └── types.ts
└── test/
    ├── adapters.test.ts
    ├── path-check.test.ts
    ├── bash-parser.test.ts
    ├── classifier.test.ts
    ├── incident.test.ts
    ├── integration.test.ts
    ├── path-policy.test.ts
    ├── performance.test.ts
    ├── powershell-parser.test.ts
    └── write-stdin.test.ts
```

Keep parsing, target resolution, policy, and final fingerprints pure where possible. Pi adapters
must translate public events into those pure inputs and apply the returned decision without copying
policy logic.

The package will be private. Add its entry point to the root Pi manifest after unified-exec and
after all other command-tool packages so its `tool_call` handler runs last. Generate tracked
settings with `npm run settings:sync`; do not edit `settings.json` by hand. Extend package-loading
tests to require the order.

## Performance

Normal commands must pay for one bounded parse and no filesystem walk. Filesystem work begins only
after the parser finds a destructive operation.

Use these implementation rules:

- initialize parsers once;
- do not cache environment-bound parse results unless measured evidence later justifies the added
  invalidation and memory rules;
- never cache path or final decisions across cwd or environment changes;
- use linear passes over syntax nodes and targets;
- avoid child processes on the Bash fast path;
- run the PowerShell helper only after a destructive lexical hit;
- keep prompts and path walks off the normal-command path.

Measure at least 10,000 classifications across short commands and a fixed corpus of 1 KiB, 8 KiB,
and 64 KiB scripts. On the repository's normal test machine, the warm Bash path must meet both of
these limits:

- p95 at or below 5 ms for commands up to 8 KiB;
- p99 at or below 20 ms for commands up to 64 KiB.

Also report raw timings, command counts, and parser initialization time. A faster parser is not
eligible if it loses syntax coverage or cross-platform reliability. If the official parser misses
the limits, optimize traversal before considering another parser.

## Failure behavior

Fail closed in these cases:

- parser initialization or grammar loading fails;
- a possible destructive command has invalid or unsupported syntax;
- path resolution, `realpath`, mount detection, or object identity fails;
- the final command differs from the checked fingerprint;
- unified-exec emits malformed integration data;
- a final event listener throws or cannot call `reject`;
- a command tool has no registered final adapter;
- extension reload leaves a live session without its input guard.

At startup, show one clear error and remove uncovered command tools instead of repeatedly warning.
Expose `/command-guard` so the user can see covered tools, blocked tools, and the pending final
check count. The command must not expose environment values, command text, credentials, or target
paths from earlier calls.

On reload, reject nonempty input to unified-exec sessions that began under an older policy instance.
Empty polls and session termination remain available so the user can inspect or stop them safely.

## State and contract impact

- **Session state:** Pi records its normal tool calls and results. The extension appends no custom
  entries and changes no existing entry.
- **Other persistent data:** None. The parser instance, session coverage, and final checks exist
  only in process memory.
- **Pi internals:** None. The package uses documented events, tool overrides, tool factories, active
  tool controls, and UI methods.
- **Unified-exec contract:** Its public pre-spawn event gains identity fields, and it gains one
  public pre-input event. These private alpha package contracts change in place.
- **Network and telemetry:** None.
- **Background work:** No service or permanent process. Parser initialization belongs to session
  lifecycle, and any short-lived parser helper ends before the decision returns.

## Scope

### Included

- The new Command Guard package and root registration.
- Bash, PowerShell, user shell, unified-exec start, and unified-exec input adapters.
- The unified-exec event changes needed for final correlation and input rejection.
- Project-independent target rules.
- One-use final checks and fail-closed behavior.
- User documentation, status command, package tests, repository tests, and performance tests.
- Source and license records for parser dependencies and any tracked grammar artifact.

### Not included

- Pi core, private Pi APIs, prototypes, or session formats.
- A project copy, overlay filesystem, container, VM, or sandbox requirement.
- A native syscall monitor, kernel module, driver, FUSE mount, or permanent service.
- Full detection of filesystem deletion hidden inside an arbitrary binary, native addon, build tool,
  remote host, or another trusted extension's direct Node filesystem call.
- Recovery, trash, snapshots, backups, or undo after an allowed command runs.
- Confirmation prompts or persistent policy configuration.
- Automatic mutation testing during normal checks.

## Implementation steps

### Package foundation

1. Create the independent package files required by `docs/adding-packages.md`.
2. Add strict TypeScript, package-local ESLint, Vitest, coverage, Slophammer, and optional mutation
   configuration matching other OnurPi packages.
3. Define strict input and decision types with no explicit `any`, unchecked casts, or unchecked
   event data.
4. Add a README that states what is covered, what is not covered, and how fail-closed behavior
   looks.
5. Add `UPSTREAM.md` before adding parser code or artifacts.

### Parser adoption

1. Pin and review the official Tree-sitter runtime and Bash grammar.
2. Test official WebAssembly and prebuilt Node paths on Linux, macOS, and Windows without adding an
   install-time source build.
3. Record exact versions, hashes, licenses, scripts, and package contents.
4. Build a typed syntax walker that extracts literal simple commands while preserving shell scope,
   quoting, substitutions, and wrapper nesting.
5. Port the relevant Codex regression command strings as attributed test data after confirming their
   license. Do not copy Codex implementation code.
6. Add conservative PowerShell and `cmd.exe` paths with the failure behavior defined above.

### Policy engine

1. Implement command-family option parsers and wrapper recursion.
2. Implement target expressions that distinguish literals, fixed environment references, and unknown
   values.
3. Implement canonical path and critical-target checks for POSIX and Windows.
4. Implement immutable decision reasons and user messages.
5. Implement final fingerprints, expiry, one-use consumption, and parallel-call isolation.
6. Enforce parser and recursion limits. Add a parse cache only if later measurements justify it.

### Pi adapters

1. Add final guarded overrides for built-in Bash and PowerShell.
2. Add the `user_bash` guarded operations path.
3. Add `tool_call` preflight for unified-exec and registered custom tools.
4. Extend unified-exec pre-spawn identity and add its pre-input event.
5. Add final synchronous fingerprint checks that call `reject` on all errors.
6. Add active-tool coverage checks and `/command-guard`.
7. Clear listeners and final checks during shutdown and reload.

### OnurPi integration

1. Register `./packages/command-guard/index.ts` last in the root Pi extension list.
2. Update package-loading and settings synchronization tests.
3. Run `npm install` only after dependency review, then inspect the lockfile diff.
4. Run `npm run settings:reset` and `npm run settings:sync`.
5. Verify `pi list`, reload Pi, and test a fresh Pi process.
6. Update this plan and package documentation if implementation evidence changes a planned rule.

## Test plan

### Incident and parser tests

Include the exact reported command shape and variants with:

- prefix assignments that do not persist;
- standalone assignments that do persist;
- loops, conditions, pipelines, traps, and substitutions;
- `sudo`, `env`, `command`, BusyBox, and nested shells;
- force options before and after operands;
- quoted text and comments that mention `rm -rf` but do not run it;
- dynamic command names, syntax errors, excessive nesting, and oversized input.

### Path tests

Use disposable fixtures for:

- empty, `.`, `..`, relative, absolute, and missing paths;
- root, home, cwd, ancestors, descendants, drive roots, UNC roots, and mount roots;
- symlinks, junctions, case changes, and nearest-existing-ancestor resolution;
- a target replaced between the first and final checks;
- variables, globs, command substitutions, aliases, functions, and `eval`;
- paths with spaces, newlines, control bytes, leading dashes, and non-ASCII text.

No test may derive a deletion target from the real home directory. Integration tests must replace
process execution with spies and prove that no spawn or input write occurred after rejection.

### Adapter and final-check tests

Cover:

- built-in Bash and PowerShell active and inactive states;
- default unified-exec mode and `--keep-builtin-bash`;
- `!` and `!!` commands;
- pre-spawn rejection, malformed event data, and swallowed event-bus errors;
- empty and nonempty `write_stdin`, control bytes, base64 bytes, split input, and stale sessions;
- a later `tool_call` mutation after the first check;
- final-check expiry, replay, duplicate calls, and parallel calls;
- unknown command tools, re-enabled blocked tools, reload, tree change, and shutdown;
- status output redaction.

### Command-family tests

Add allow, rewrite, and denial cases for every listed command family. Each family must test option
order, `--`, nested use, quoted operands, multiple targets, and a safe command with similar text.

### Performance tests

Keep performance fixtures deterministic and separate from correctness assertions. Warm up the
parser, measure raw durations with a monotonic clock, and report percentiles and maximums. CI may
use a generous regression ceiling; release evidence must include the tighter target measurements
from a stable local run.

## Acceptance criteria

- The exact reported `HOME` cleanup pattern is blocked before spawn.
- `rm -rf /`, the home directory itself, the cwd itself, their ancestors, drive roots, UNC roots,
  and mount roots cannot run.
- A destructive command with a variable changed in the script, a glob, substitution, `eval`, or an
  unknown target is blocked with a literal-target rewrite instruction.
- An exact non-critical deletion runs without a prompt.
- A changed command, cwd, shell, environment, target, or object identity invalidates the final
  check.
- Normal commands run without a prompt and meet the performance limits.
- Built-in Bash, PowerShell, user shell, unified-exec spawn, and unified-exec input all have a final
  rejection point.
- Empty unified-exec polls and session termination remain available after reload.
- Any active command tool without a final adapter is blocked and named by the status command.
- Print and JSON modes use the same no-prompt allow-or-block policy.
- The package works on Linux, macOS, and Windows or blocks unsupported destructive syntax before
  execution.
- The extension writes no session state, policy file, confirmation record, telemetry, or secret.
- No Pi source or private API is used.

## Verification

Run focused package checks first:

```bash
npm run check --workspace @onurpi/command-guard
npm run check --workspace @onurpi/unified-exec
```

Run repository checks:

```bash
npm run check
npm run slophammer
git diff --check
npx -y @simpledoc/simpledoc check
```

Then run controlled extension tests with process spies and harmless commands:

- load the package with `pi -e` in TUI mode;
- verify one exact literal deletion against a disposable fixture without a prompt;
- verify the incident command is rejected without spawning;
- verify print and JSON modes use the same decision;
- start a harmless managed session, test empty polling, and confirm nonempty shell input is blocked;
- reload Pi and confirm stale session input remains blocked while polling and termination work;
- run `pi list` and verify the canonical package path;
- run the performance corpus and save the raw summary in the implementation report.

Do not run destructive smoke tests against real user paths. Do not run mutation tests unless the
user explicitly requests them.

## Known limit

A command parser sees shell source, not filesystem calls inside an arbitrary executable. A program
such as `python script.py` can delete files without exposing that action in its command line. An
extension-only command guard cannot stop that case efficiently and portably without a sandbox or
native operating-system monitor. The package must state this limit in its README and status output
instead of claiming complete filesystem protection.
