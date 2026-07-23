# Codex shell execution behavior

This document describes shell execution in OpenAI Codex and records the distinction that matters for
OnurPi. The source references are pinned to Codex commit
[`0fb559f0f6e231a88ac02ea002d3ecd248e2b515`](https://github.com/openai/codex/tree/0fb559f0f6e231a88ac02ea002d3ecd248e2b515).
Behavior may change after that commit.

Codex has two shell execution paths. The classic `shell_command` tool treats ten seconds as a
process-lifetime timeout. Unified execution treats ten seconds as an initial wait before returning
control to the model. A long-running unified-exec process continues in the background and is
addressed by a session ID.

## Execution paths

| Model-visible tools           | Ten-second default        | Result when the interval ends                                     |
| ----------------------------- | ------------------------- | ----------------------------------------------------------------- |
| `shell_command`               | Maximum command runtime   | Codex terminates the process tree and reports a timeout           |
| `exec_command`, `write_stdin` | Initial attachment window | Codex returns output and a session ID while the process continues |

Codex chooses the path from the model configuration, feature flags, platform PTY support, and shell
backend. When unified execution is selected, `exec_command` and `write_stdin` are model-visible. The
classic handler remains registered for internal dispatch. If unified execution is unavailable, Codex
exposes `shell_command` instead. The selection logic lives in
[`tools/spec_plan.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/tools/spec_plan.rs#L636-L676)
and
[`tools/src/tool_config.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/tools/src/tool_config.rs#L65-L111).

This distinction explains apparently conflicting statements about Codex's ten-second default. Both
statements are true, but they apply to different tools.

## Classic shell command

### Tool contract

`shell_command` accepts a shell script, a working directory, and an optional `timeout_ms`. Its
schema describes `timeout_ms` as the maximum command runtime and assigns a default of 10,000
milliseconds. See
[`shell_spec.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/tools/handlers/shell_spec.rs#L165-L213).

The default comes from `DEFAULT_EXEC_COMMAND_TIMEOUT_MS` in
[`exec.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/exec.rs#L55-L65).
An explicit timeout replaces the default. There is no 120-second policy in this path. A caller can
request a substantially longer timeout.

### Timeout handling

Classic execution races process completion against `ExecExpiration`. The default expiration sleeps
for ten seconds. An explicit timeout sleeps for the requested duration. Cancellation can participate
in the same race. The expiration implementation is in
[`exec.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/exec.rs#L177-L215).

When the timeout wins, Codex terminates the command's process group. The result is marked as timed
out and normalized to exit code `124`, the conventional shell timeout code. See
[`exec.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/exec.rs#L775-L800).

Process-group termination matters because a shell can start children and grandchildren. Killing only
the shell PID can leave those descendants running. Codex's PTY utility creates process groups and
provides group-level interrupt and termination operations in
[`process_group.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/utils/pty/src/process_group.rs).

Codex also bounds post-exit pipe draining to two seconds. A grandchild may inherit stdout or stderr
and keep the descriptor open after the direct child dies. Without the drain ceiling, output
collection could block forever even though the command was killed. The rationale and constant are in
[`exec.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/exec.rs#L82-L89).
This behavior was addressed upstream in [PR #6575](https://github.com/openai/codex/pull/6575).
Process-group cleanup was addressed in [PR #5258](https://github.com/openai/codex/pull/5258).

### Classic-path result

A classic call has one blocking lifetime. It returns when the command exits, the timeout expires, or
cancellation terminates it. There is no session ID and no later poll. This path protects an omitted
timeout with a ten-second kill deadline. A caller that explicitly requests a long timeout can still
run for that long.

## Unified execution

Unified execution is a managed process-session system. `exec_command` starts a process and
`write_stdin` revisits it. The model can poll output, send terminal input, or interrupt the process
without keeping one tool call open for the command's full lifetime.

### `exec_command` contract

The model-facing parameters are defined in
[`shell_spec.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/tools/handlers/shell_spec.rs#L21-L103).

| Parameter           | Default                | Meaning                                               |
| ------------------- | ---------------------- | ----------------------------------------------------- |
| `cmd`               | Required               | Shell command to execute                              |
| `workdir`           | Turn working directory | Working directory for the command                     |
| `shell`             | User shell             | Shell binary, when the selected backend permits it    |
| `tty`               | `false`                | Allocate a PTY when true; use plain pipes when false  |
| `yield_time_ms`     | `10000`                | Time to stay attached before returning a live session |
| `max_output_tokens` | `10000`                | Model-visible output budget                           |

`yield_time_ms` is clamped to 250 through 30,000 milliseconds. Windows raises the initial minimum to
two seconds. The constants and clamp are in
[`unified_exec/mod.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/unified_exec/mod.rs#L64-L73)
and
[`unified_exec/mod.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/unified_exec/mod.rs#L169-L179).

The tool schema contains no command-lifetime timeout. Ten seconds controls the first response only.

### Startup and initial yield

An `exec_command` call follows this sequence:

1. Resolve the target environment and permission request, then select the working directory and
   shell.
2. Apply approval policy and sandbox selection.
3. Spawn a local PTY or pipe process, or start the process through an exec server.
4. Start streaming output into bounded buffers and tool events.
5. Store the live process before waiting for the initial yield.
6. Collect output until the process exits or `yield_time_ms` expires.
7. Return an exit code for a completed process or a session ID for a live process.

The process is deliberately stored before the initial wait. The source comment explains that a turn
interruption must not drop the final process reference and terminate background work. See
[`process_manager.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/unified_exec/process_manager.rs#L452-L501).

After the wait, `refresh_process_state()` determines the response. A live process retains its ID. An
exited process returns its exit code and is removed from the store. See
[`process_manager.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/unified_exec/process_manager.rs#L558-L650).

Codex gives newly spawned processes a 150-millisecond early-exit grace period. Very short commands
usually finish before the process needs long-lived session management. Longer commands get an exit
watcher and remain available to the manager. The local and exec-server paths implement this in
[`process.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/unified_exec/process.rs#L330-L418).

One implementation detail can mislead source readers. Unified runtime preparation carries an
`ExecExpiration::DefaultTimeout` through the generic sandbox request types. The persistent session
path starts the PTY or exec-server process through `open_session_with_prepared_exec_env()` and then
uses the process manager's yield deadlines. It does not run the classic blocking expiration loop.
The model-facing unified tool exposes `yield_time_ms`. The `timeout_ms` parameter belongs to the
classic tool. See
[`unified_exec.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/tools/runtimes/unified_exec.rs#L104-L113)
and
[`process_manager.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/unified_exec/process_manager.rs#L956-L1004).

### `write_stdin` contract

`write_stdin` accepts a `session_id`, optional `chars`, `yield_time_ms`, and `max_output_tokens`.
Empty `chars` polls without writing. The schema is in
[`shell_spec.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/tools/handlers/shell_spec.rs#L113-L153).

The default call wait is 250 milliseconds. Codex applies different limits according to the request:

| Operation               | Effective wait                           |
| ----------------------- | ---------------------------------------- |
| Nonempty terminal write | 250 ms through 30 seconds                |
| Empty background poll   | 5 seconds through 300 seconds by default |

The 300-second value is configurable through the maximum background-terminal timeout. It limits one
poll call. It does not limit the underlying process. The clamping logic is in
[`process_manager.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/unified_exec/process_manager.rs#L726-L747).

Interactions against one session are serialized with a per-process lock because input, output
draining, and lifecycle state are shared. Different sessions can be polled concurrently. See
[`process_manager.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/unified_exec/process_manager.rs#L657-L674).

### PTY and pipe behavior

A PTY session accepts normal input through `write_stdin`. This supports REPLs and debuggers,
including programs that display password prompts.

A pipe session does not accept arbitrary follow-up stdin. Codex recognizes the Ctrl-C byte as an
interrupt request and rejects other nonempty writes as closed stdin. Empty polls work in either
mode. The branch is visible in
[`process_manager.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/unified_exec/process_manager.rs#L696-L723).

The default is `tty: false`. Commands that need later interactive input must request a PTY when they
start.

### Process lifetime

Unified execution has no ten-second or 120-second process-lifetime ceiling. A process remains
managed until one of these events occurs:

- It exits naturally and a later state refresh removes it.
- The agent or user interrupts or terminates it.
- Process-store pruning selects it.
- The Codex session shuts down.
- A sandbox or managed-network failure terminates it.
- The process handle is otherwise dropped after removal from management.

Interrupting an agent turn does not automatically kill a process already stored by unified exec.
This behavior allows builds, downloads, tests, development servers, or REPLs to survive across model
turns.

### Process store

The manager allows up to 64 unified-exec processes. When a new process arrives at capacity, Codex
protects the eight most recently used entries. It first chooses the least recently used exited entry
outside that protected set. If none exists, it chooses the least recently used live entry outside
the set. An entry currently held by `write_stdin` cannot be pruned. A pruned live process is
terminated.

The constants and pruning code are in
[`unified_exec/mod.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/unified_exec/mod.rs#L64-L73)
and
[`process_manager.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/unified_exec/process_manager.rs#L1375-L1429).

Codex can list live background terminals and terminate a selected process through session-level
operations. The model tool surface at this commit contains `exec_command` and `write_stdin`; there
is no separate model-facing `kill_session` tool. A model can send Ctrl-C through `write_stdin`,
while the application can call the manager's termination operation.

Session shutdown drains the store and terminates every remaining process. See
[`process_manager.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/unified_exec/process_manager.rs#L1431-L1478)
and
[`session/handlers.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/session/handlers.rs#L597-L606).

### Output handling

Unified execution retains at most one MiB in each `HeadTailBuffer`. Half of the budget preserves the
start of the stream and half preserves the latest output. Once the buffer fills, Codex drops bytes
from the middle and inserts an omission marker. The implementation is in
[`head_tail_buffer.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/unified_exec/head_tail_buffer.rs#L1-L146).

The tool response applies a separate model-visible budget of 10,000 tokens by default. Output also
streams to Codex events while the tool is attached. This bounds model context and process memory,
but Codex does not preserve an unlimited full-output file for later reading.

### Approval and sandbox integration

Unified execution goes through the same command approval and sandbox orchestration used by other
Codex tools. The process request includes its working directory, environment, sandbox permissions,
additional permissions, network context, and PTY choice. A sandbox denial can trigger the normal
approval and retry flow when policy permits.

Codex also registers unified execution as a Bash pre-tool and post-tool operation for hook
compatibility. `write_stdin` does not emit a second pre-tool hook because it continues a command
that was already approved. A poll that observes final completion can emit the original command's
matching post-tool event. See
[`exec_command.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs#L347-L397)
and
[`write_stdin.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs#L88-L111).

## Runaway-command behavior

Codex does not analyze computational complexity. There is no detector for exponential search, an
unbounded loop, or a command that will consume excessive CPU. The sandbox controls permissions and
network access; it is not a general CPU-time quota.

The outcome of an accidental brute-force command depends on the selected tool:

| Situation                    | Classic `shell_command`                      | Unified `exec_command`                                   |
| ---------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| Timeout omitted              | Killed after ten seconds                     | Returns a session ID after ten seconds and continues     |
| Long explicit wait requested | Runs until that timeout or completion        | Wait is clamped, then the process continues              |
| Model turn interrupted       | Cancellation can terminate classic execution | Stored background process survives the turn interruption |
| Session closes               | Active command is cancelled                  | Every managed unified process is terminated              |

Unified execution solves agent blocking. It does not guarantee that a wasteful background process
stops promptly. The agent or user must interrupt it, terminate it through the application, or close
the session. Store pressure may eventually prune it. This mechanism manages process capacity and
does not bound CPU use.

For the reported `2^170` search, classic execution with an omitted timeout would stop after ten
seconds. Unified execution would return control after ten seconds and leave the search running. It
could continue consuming CPU until interrupted or cleaned up by one of the lifecycle paths above.

## OnurPi comparison

Pi's built-in `bash` tool is a blocking command tool with an optional process-lifetime timeout. At
the time of this investigation, omitting `timeout` means there is no default deadline. Pi already
supports cancellation, process-tree termination, bounded output, and inherited-pipe handling.

An earlier OnurPi package mutated `bash` calls before execution. It inserted a ten-second lifetime
timeout when the model omitted one and capped explicit timeouts at 120 seconds. That policy
resembled a stricter form of Codex's classic `shell_command`, not unified execution. It was removed
because it terminated legitimate commands and could not support managed sessions.

| Capability                         | Pi built-in `bash`                | Removed timeout policy | Codex unified exec               |
| ---------------------------------- | --------------------------------- | ---------------------- | -------------------------------- |
| Default behavior after ten seconds | Continue blocking                 | Kill process tree      | Return session ID                |
| Explicit runtime above 120 seconds | Allowed                           | Capped and killed      | Process lifetime is uncapped     |
| Poll later                         | No                                | No                     | Yes                              |
| Send PTY input later               | No                                | No                     | Yes                              |
| Survive model-turn interruption    | No managed session                | No managed session     | Yes                              |
| Session-level process cleanup      | Current call and tracked children | Same as Pi             | Managed process store is drained |

OnurPi now vendors `@onurpi/unified-exec` under `packages/unified-exec`, based on upstream
`pi-unified-exec` v0.7.3. It provides `exec_command`, `write_stdin`, managed process sessions, PTY
support, bounded output, pruning, and shutdown cleanup. Its ten-second default is an initial yield
interval, and it does not impose a process-lifetime cap.

The package is close to Codex's execution lifecycle but is not an exact clone. It adds model-facing
session management, optional completion wakeups, absolute waits, and full output logs under the
system temporary directory. It also lacks Codex's sandbox and approval stack. The complete upstream
review and local changes are recorded in
[`packages/unified-exec/UPSTREAM.md`](../packages/unified-exec/UPSTREAM.md).

## Source map

| Source                                                                                                                                                                           | Responsibility                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`core/src/tools/spec_plan.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/tools/spec_plan.rs#L636-L676)                    | Chooses classic or unified model-visible tools                                        |
| [`tools/src/tool_config.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/tools/src/tool_config.rs#L65-L111)                           | Combines model settings with feature and platform checks                              |
| [`core/src/tools/handlers/shell_spec.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/tools/handlers/shell_spec.rs#L21-L213) | Defines schemas for all three shell tools                                             |
| [`core/src/exec.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/exec.rs)                                                    | Runs classic commands and handles expiration, output draining, and timeout results    |
| [`core/src/unified_exec/mod.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/unified_exec/mod.rs)                            | Defines unified-exec request and store types plus constants                           |
| [`core/src/unified_exec/process_manager.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/unified_exec/process_manager.rs)    | Manages session startup, polling, pruning, listing and termination                    |
| [`core/src/unified_exec/process.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/unified_exec/process.rs)                    | Wraps local and remote processes, streams output, writes input, and tracks exit state |
| [`core/src/unified_exec/head_tail_buffer.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/unified_exec/head_tail_buffer.rs)  | Bounds output while preserving its beginning and end                                  |
| [`utils/pty/src/process_group.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/utils/pty/src/process_group.rs)                        | Creates and signals process groups                                                    |
| [`core/src/session/handlers.rs`](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/core/src/session/handlers.rs#L597-L606)                  | Terminates managed processes during session shutdown                                  |
