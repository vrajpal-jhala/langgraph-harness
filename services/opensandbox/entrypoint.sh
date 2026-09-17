#!/bin/bash
set -euo pipefail

CONFIG_PATH="/root/.sandbox.toml"

# * Update the repositories and worktrees paths when app data path is changed
if [ -n "${DATA_PATH:-}" ]; then
  sed -i "s|^allowed_host_paths = .*|allowed_host_paths = [\"${DATA_PATH}/app/repositories\", \"${DATA_PATH}/app/worktrees\"]|" "$CONFIG_PATH"
fi

# * Dev-only: type = "" to disable secure_runtime validation.
if [ -n "${OPENSANDBOX_DISABLE_SECURE_RUNTIME:-}" ]; then
  sed -i '/^\[secure_runtime\]/,/^\[/{s|^type = .*|type = ""|; /^docker_runtime = /d}' "$CONFIG_PATH"
fi

# * Dev-only: run sandboxes on this project's network instead of Docker's default bridge, which opensandbox itself can't join.
if [ -n "${OPENSANDBOX_SANDBOX_NETWORK:-}" ]; then
  sed -i "s|^network_mode = .*|network_mode = \"${OPENSANDBOX_SANDBOX_NETWORK}\"|" "$CONFIG_PATH"
fi

exec opensandbox-server
