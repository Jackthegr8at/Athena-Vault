#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
environment_file=${1:-"$project_root/.env.docker.prod"}
if [ ! -f "$environment_file" ]; then
  echo "Missing production Docker environment file." >&2
  exit 2
fi

exec docker compose --env-file "$environment_file" \
  -f "$project_root/docker-compose.yml" \
  -f "$project_root/docker-compose.prod.yml" \
  up --detach --build --wait postgres migrations web caddy
