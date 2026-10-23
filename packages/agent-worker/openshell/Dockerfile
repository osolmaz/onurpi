# Sandbox image for the agent worker. build-image.sh sends the committed OnurPi tree as the build
# context, so the image holds no local or private files.
FROM node:22.22.0-trixie-slim AS whisper-build
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential ca-certificates cmake curl git \
  && rm -rf /var/lib/apt/lists/*
ARG WHISPER_CPP_VERSION=v1.9.5
ARG WHISPER_MODEL=ggml-small.bin
RUN git clone --depth 1 --branch "${WHISPER_CPP_VERSION}" https://github.com/ggml-org/whisper.cpp /src
RUN cmake -S /src -B /build -DGGML_NATIVE=OFF -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
  && cmake --build /build --target whisper-cli -j"$(nproc)"
RUN mkdir -p /models \
  && curl -fsSL -o /models/ggml-small.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL}"

FROM node:22.22.0-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl ffmpeg gh git jq python3 ripgrep \
  && rm -rf /var/lib/apt/lists/*

# Google Workspace CLI, pinned to release archives with known SHA256 values. The
# google-workspace provider profile supplies its login, so the image holds no credential.
ARG GWS_VERSION=0.22.5
RUN arch="$(uname -m)" \
  && case "${arch}" in \
    aarch64) sha=94490295d9580e1e88574e715a0a162991747d12d62f8c7b8dcc8268b6c1cea0 ;; \
    x86_64) sha=de78ecdbd2f1a84cca0063a7ecbc440240fc14b6ebccbb17f4646b792a8c5c1f ;; \
    *) echo "unsupported architecture: ${arch}" >&2; exit 1 ;; \
  esac \
  && asset="google-workspace-cli-${arch}-unknown-linux-gnu.tar.gz" \
  && curl -fsSL -o "/tmp/${asset}" \
    "https://github.com/googleworkspace/cli/releases/download/v${GWS_VERSION}/${asset}" \
  && echo "${sha}  /tmp/${asset}" | sha256sum -c - \
  && mkdir /tmp/gws && tar xf "/tmp/${asset}" -C /tmp/gws \
  && install -m 0755 "$(find /tmp/gws -type f -name gws | head -1)" /usr/local/bin/gws \
  && rm -rf /tmp/gws "/tmp/${asset}"

# The workload runs as uid 1001, the owner of the mounted host workspace.
RUN useradd --uid 1001 --create-home --shell /bin/bash agent

WORKDIR /app
COPY . /app
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=whisper-build /build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper-build /models/ggml-small.bin /app/models/ggml-small.bin

USER agent
# OpenShell treats the image's working folder as its own workspace and refuses a mount there,
# so the image starts in the home folder; the worker's tools use the mounted /sandbox/work.
WORKDIR /home/agent
