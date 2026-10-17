#!/bin/sh
# Starts the agent worker inside the sandbox with the mounted configuration. jiti is the loader
# that Pi uses for extensions; it is given by path because the working folder is the workspace.
exec node --import /app/node_modules/jiti/lib/jiti-register.mjs \
  /app/packages/agent-worker/src/cli.ts run --config /sandbox/config/config.json
