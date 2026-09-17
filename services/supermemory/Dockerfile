FROM node:22-slim

# So a failed curl below fails the build instead of installing nothing silently.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV SUPERMEMORY_DATA_DIR=/data
# Don't auto-start (no runtime env/LLM key available yet at build time)
ENV SUPERMEMORY_NO_START=1
# Don't prompt (no TTY during docker build)
ENV SUPERMEMORY_NO_PROMPT=1

RUN curl -fsSL https://github.com/supermemoryai/supermemory/releases/download/server-v0.0.8/install.sh | bash -s -- 0.0.8

EXPOSE 6767

CMD ["/root/.local/bin/supermemory-server"]
