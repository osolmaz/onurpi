#!/bin/sh
set -eu

workflow=".github/workflows/ci.yml"
cleanup() {
  rm -f "$workflow"
  rmdir .github/workflows .github 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

mkdir -p .github/workflows
cp ../../.github/workflows/ci.yml "$workflow"
slophammer-ts check . --execute
