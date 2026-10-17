#!/bin/sh
# Starts the agent worker inside the sandbox with the mounted configuration. jiti is the loader
# that Pi uses for extensions; it is given by path because the working folder is not /app. The
# log goes to the workspace, where the owner can read it from the host.
mkdir -p /sandbox/work/.agent-worker
exec node --import /app/node_modules/jiti/lib/jiti-register.mjs \
  /app/packages/agent-worker/src/cli.ts run --config /sandbox/config/config.json \
  >>/sandbox/work/.agent-worker/worker.log 2>&1
