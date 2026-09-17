#!/bin/bash
set -euo pipefail

# Re-exec after the pull so this commit's own changes to this file take effect now, not next deploy.
if [ "${HARNESS_UPDATE_REEXECED:-}" != "1" ]; then
  git pull
  exec env HARNESS_UPDATE_REEXECED=1 bash "$0"
fi

set -a && source backend/.env && set +a

: "${DATA_PATH:?DATA_PATH is not set in backend/.env}"
mkdir -p "$DATA_PATH"

docker compose build backend frontend db-migrate supermemory opensandbox monitoring
docker compose --profile migrate run --rm db-migrate
# New service? Add it here too — this deploy flow never creates one automatically.
docker compose up -d lightpanda supermemory docker-socket-proxy-kata opensandbox docker-socket-proxy-system monitoring
docker compose up -d --no-deps --force-recreate backend frontend

echo "Pruning build cache unused for 7+ days..."
docker builder prune -af --filter "until=168h"

echo "Update complete."
