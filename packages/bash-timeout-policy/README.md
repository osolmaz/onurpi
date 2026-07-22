# @onurpi/bash-timeout-policy

`@onurpi/bash-timeout-policy` prevents model-initiated Pi `bash` calls from running indefinitely.

The extension applies two limits before Pi executes the command:

- A call without `timeout` receives a **10-second default**, matching Codex's classic shell default.
- A call requesting more than **120 seconds** is capped at 120 seconds.

Pi's built-in bash implementation still performs execution, rendering, cancellation, output
truncation, and process-tree termination. The extension does not inspect commands or try to infer
algorithmic complexity.

## Scope

The policy applies only to the `bash` tool exposed to the model. It does not affect:

- `!` and `!!` commands entered directly by the user
- commands run by other extensions through `pi.exec`
- custom process tools
- commands launched in a separate terminal

Explicit positive timeouts up to 120 seconds are preserved. Invalid values remain unchanged so Pi's
built-in validator rejects them normally.

## Install

From the OnurPi repository root, install the local package and reload Pi:

```bash
pi install ./packages/bash-timeout-policy
```

```text
/reload
```

The extension has no commands or settings. It activates automatically for model `bash` calls.

## Persistence

The extension stores no state and writes no configuration. Pi continues to record its normal tool
calls and results.
