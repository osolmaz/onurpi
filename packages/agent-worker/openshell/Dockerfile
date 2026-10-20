# Sandbox image for the agent worker. build-image.sh sends the committed OnurPi tree as the build
# context, so the image holds no local or private files.
FROM node:22.22.0-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl ffmpeg gh git jq python3 ripgrep \
  && rm -rf /var/lib/apt/lists/*

# The workload runs as uid 1001, the owner of the mounted host workspace.
RUN useradd --uid 1001 --create-home --shell /bin/bash agent

WORKDIR /app
COPY . /app
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund && npm cache clean --force

USER agent
# OpenShell treats the image's working folder as its own workspace and refuses a mount there,
# so the image starts in the home folder; the worker's tools use the mounted /sandbox/work.
WORKDIR /home/agent
