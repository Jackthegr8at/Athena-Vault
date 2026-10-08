#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
environment_file=${1:-"$project_root/.env.docker.prod"}
host_ip=${ATHENA_HTTPS_HOST_IP:-}
private_hostname=${ATHENA_HTTPS_HOSTNAME:-}

fail() {
  echo "private_https=failed reason=$1" >&2
  exit 1
}

[ -f "$environment_file" ] || fail missing-environment-file
[ "${ATHENA_ROTATE_AUTH_SECRET:-}" = true ] || fail rotation-confirmation-required
command -v openssl >/dev/null 2>&1 || fail missing-openssl
command -v awk >/dev/null 2>&1 || fail missing-awk

read_environment_value() {
  sed -n "s/^$1=//p" "$environment_file" | tail -n 1 | tr -d '\r'
}

[ -n "$host_ip" ] || host_ip=$(read_environment_value ATHENA_PROD_BIND_HOST)
[ -n "$private_hostname" ] || private_hostname=$(read_environment_value ATHENA_PRIVATE_HOSTNAME)
[ -n "$host_ip" ] || fail missing-bind-host
[ -n "$private_hostname" ] || fail missing-private-hostname

if grep -Fqx "BETTER_AUTH_URL=https://$private_hostname" "$environment_file" \
  && grep -Fqx 'ATHENA_AUTH_COOKIE_SECURE=true' "$environment_file"; then
  fail already-enabled
fi

environment_dir=$(CDPATH= cd -- "$(dirname -- "$environment_file")" && pwd)
environment_name=$(basename -- "$environment_file")
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_file="$environment_dir/$environment_name.pre-https-$timestamp"
secret_file=$(mktemp "$environment_dir/.athena-auth-secret.XXXXXX")
output_file=$(mktemp "$environment_dir/.athena-env.XXXXXX")

cleanup() {
  rm -f "$secret_file" "$output_file"
}
trap cleanup EXIT HUP INT TERM

umask 077
cp -p "$environment_file" "$backup_file"
chmod 600 "$backup_file"
openssl rand -hex 48 > "$secret_file"
chmod 600 "$secret_file"

awk \
  -v secret_file="$secret_file" \
  -v host_ip="$host_ip" \
  -v private_hostname="$private_hostname" '
BEGIN {
  if ((getline auth_secret < secret_file) <= 0 || auth_secret == "") exit 2
  close(secret_file)
}
/^BETTER_AUTH_SECRET=/ { print "BETTER_AUTH_SECRET=" auth_secret; seen_secret=1; next }
/^BETTER_AUTH_URL=/ { print "BETTER_AUTH_URL=https://" private_hostname; seen_url=1; next }
/^ATHENA_AUTH_COOKIE_SECURE=/ { print "ATHENA_AUTH_COOKIE_SECURE=true"; seen_cookie=1; next }
/^ATHENA_PROD_BIND_HOST=/ { print "ATHENA_PROD_BIND_HOST=" host_ip; seen_bind=1; next }
/^ATHENA_PROD_HTTP_PORT=/ { print "ATHENA_PROD_HTTP_PORT=80"; seen_http=1; next }
/^ATHENA_PROD_HTTPS_PORT=/ { print "ATHENA_PROD_HTTPS_PORT=443"; seen_https=1; next }
/^ATHENA_AUTH_PUBLIC_HTTPS_PORT=/ { print "ATHENA_AUTH_PUBLIC_HTTPS_PORT=443"; seen_public_https=1; next }
/^ATHENA_PRIVATE_HOSTNAME=/ { print "ATHENA_PRIVATE_HOSTNAME=" private_hostname; seen_hostname=1; next }
{ print }
END {
  if (!seen_secret) print "BETTER_AUTH_SECRET=" auth_secret
  if (!seen_url) print "BETTER_AUTH_URL=https://" private_hostname
  if (!seen_cookie) print "ATHENA_AUTH_COOKIE_SECURE=true"
  if (!seen_bind) print "ATHENA_PROD_BIND_HOST=" host_ip
  if (!seen_http) print "ATHENA_PROD_HTTP_PORT=80"
  if (!seen_https) print "ATHENA_PROD_HTTPS_PORT=443"
  if (!seen_public_https) print "ATHENA_AUTH_PUBLIC_HTTPS_PORT=443"
  if (!seen_hostname) print "ATHENA_PRIVATE_HOSTNAME=" private_hostname
}
' "$environment_file" > "$output_file" || fail environment-rewrite-failed

chmod 600 "$output_file"
mv "$output_file" "$environment_file"
rm -f "$secret_file"
trap - EXIT HUP INT TERM

echo "private_https=status=configured origin=https://$private_hostname backup=$(basename -- "$backup_file") auth_secret=rotated"
