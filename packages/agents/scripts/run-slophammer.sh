#!/bin/sh
set -eu

created_agents=0
created_workflow=0
workflow=.github/workflows/ci.yml

cleanup() {
  if [ "$created_agents" = 1 ]; then
    rm -f AGENTS.md
  fi
  if [ "$created_workflow" = 1 ]; then
    rm -f "$workflow"
    rmdir .github/workflows .github 2>/dev/null || true
  fi
}
trap cleanup EXIT HUP INT TERM

if [ ! -e AGENTS.md ]; then
  : > AGENTS.md
  created_agents=1
fi

if [ ! -e "$workflow" ]; then
  mkdir -p "$(dirname "$workflow")"
  cp ../../.github/workflows/ci.yml "$workflow"
  created_workflow=1
fi

slophammer-ts check .
