#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
environment_file=${ATHENA_DOCKER_ENV_FILE:-"$project_root/.env.docker.prod"}
if [ ! -f "$environment_file" ]; then
  echo "Missing production Docker environment file." >&2
  exit 2
fi

tail_lines=${ATHENA_LOG_TAIL:-100}
exec docker compose --env-file "$environment_file" \
  -f "$project_root/docker-compose.yml" \
  -f "$project_root/docker-compose.prod.yml" \
  logs --no-color --tail "$tail_lines" "$@"
