#!/bin/sh
# Builds the agent worker sandbox image from the committed OnurPi tree and prints its tag.
set -eu
root=$(git rev-parse --show-toplevel)
revision=$(git -C "$root" rev-parse --short=12 HEAD)
tag="agent-worker:$revision"
git -C "$root" archive --format=tar HEAD |
  docker build --quiet --tag "$tag" --file packages/agent-worker/openshell/Dockerfile - >/dev/null
echo "$tag"
