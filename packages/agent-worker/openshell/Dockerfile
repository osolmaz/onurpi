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
