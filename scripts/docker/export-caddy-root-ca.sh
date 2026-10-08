#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
environment_file=${1:-"$project_root/.env.docker.prod"}
default_output_path="$project_root/.tmp/certificates/athena-vault-caddy-root.crt"
output_path=${2:-"$default_output_path"}

if [ "$#" -gt 2 ]; then
  echo "Usage: sh scripts/docker/export-caddy-root-ca.sh [environment-file] [output-path]" >&2
  exit 2
fi

case "$environment_file" in
  /*) ;;
  *) environment_file="$project_root/$environment_file" ;;
esac

case "$output_path" in
  /*) ;;
  *) output_path="$project_root/$output_path" ;;
esac

if [ ! -f "$environment_file" ]; then
  echo "Missing Docker environment file." >&2
  exit 2
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to export Caddy's root certificate." >&2
  exit 2
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "OpenSSL is required to validate Caddy's root certificate." >&2
  exit 2
fi

output_dir=$(dirname "$output_path")
umask 077
mkdir -p "$output_dir"
staging_dir=$(mktemp -d "$output_dir/.athena-caddy-root.XXXXXX")
staging_file="$staging_dir/root.crt"

cleanup() {
  rm -f "$staging_file"
  rmdir "$staging_dir" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

compose() {
  # Keep ambient ATHENA_*/COMPOSE_* variables from overriding the protected file.
  env -i \
    "PATH=${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}" \
    "HOME=${HOME:-/root}" \
    docker compose --env-file "$environment_file" \
    -f "$project_root/docker-compose.yml" \
    -f "$project_root/docker-compose.prod.yml" "$@"
}

if ! compose config --quiet; then
  echo "Docker Compose configuration is invalid; Caddy root certificate was not exported." >&2
  exit 3
fi

if ! compose cp caddy:/data/caddy/pki/authorities/local/root.crt "$staging_file"; then
  echo "Caddy root certificate was not found. Ensure the Caddy service is running and healthy." >&2
  exit 4
fi
if [ ! -s "$staging_file" ]; then
  echo "Caddy root certificate export was empty." >&2
  exit 5
fi
if ! openssl x509 -in "$staging_file" -noout >/dev/null 2>&1; then
  echo "Exported Caddy root certificate is not a valid X.509 certificate." >&2
  exit 6
fi
if ! openssl x509 -in "$staging_file" -noout -text 2>/dev/null | grep -Fq "CA:TRUE"; then
  echo "Exported certificate is not marked as a certificate authority." >&2
  exit 7
fi

chmod 644 "$staging_file"
mv -f "$staging_file" "$output_path"
echo "caddy-root-ca=exported path=$output_path"
