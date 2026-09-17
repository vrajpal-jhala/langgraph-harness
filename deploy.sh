#!/bin/bash
set -euo pipefail

set -a && source backend/.env && set +a

: "${DATA_PATH:?DATA_PATH is not set in backend/.env}"
mkdir -p "$DATA_PATH"
# opensandbox's allowed_host_paths needs this absolute.
export DATA_PATH="$(cd "$DATA_PATH" && pwd)"

mkdir -p "${DATA_PATH}/postgres"
mkdir -p "${DATA_PATH}/redis"
mkdir -p "${DATA_PATH}/app"
mkdir -p "${DATA_PATH}/supermemory"
mkdir -p "${DATA_PATH}/opensandbox"

docker compose up -d --build postgres redis
docker compose --profile migrate run --rm db-migrate
docker compose up -d --build lightpanda supermemory opensandbox monitoring
docker compose up -d --no-deps backend frontend

echo "Deploy complete. Server running at http://localhost:3698 and App running at http://localhost:5173"
