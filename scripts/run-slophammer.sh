#!/bin/sh
set -eu

generated_workflows=""
cleanup() {
  for workflow in $generated_workflows; do
    rm -f "$workflow"
    rmdir "$(dirname "$workflow")" "$(dirname "$(dirname "$workflow")")" 2>/dev/null || true
  done
}
if [ "${KEEP_SLOPHAMMER_WORKFLOWS:-0}" != "1" ]; then
  trap cleanup EXIT HUP INT TERM
fi

for package in packages/*; do
  [ -f "$package/tsconfig.json" ] || continue
  workflow="$package/.github/workflows/ci.yml"
  [ -e "$workflow" ] && continue
  mkdir -p "$(dirname "$workflow")"
  cp .github/workflows/ci.yml "$workflow"
  generated_workflows="$generated_workflows $workflow"
done

slophammer-ts check .
