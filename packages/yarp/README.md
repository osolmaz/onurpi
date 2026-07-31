# YARP

This package loads the YARP Pi extension from a pinned upstream commit. YARP wraps a strict
allowlist of developer commands and removes the middle of long output before it enters Pi's context.
Unsupported commands and rewrite failures run unchanged.

## Binary

The extension requires the `yarp` binary on `PATH`. Install the same upstream revision:

```sh
cargo install \
  --git https://github.com/osolmaz/yarp.git \
  --rev e8e976c44a055c4f3945351cf8813e5b92340dd7 \
  --locked
```

Set `YARP_DISABLED=1` to disable command rewriting without removing the package.

## Pi contract

YARP uses Pi's documented `tool_call` hook to update supported `bash` and `exec_command` inputs. It
uses `pi.exec` to query the local binary. It does not change session state, other persistent data,
or Pi internals.

See [UPSTREAM.md](UPSTREAM.md) for the reviewed source and security notes.
