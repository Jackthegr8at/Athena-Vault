#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
script="$project_root/scripts/docker/enable-private-https.sh"

fail() {
  echo "enable_private_https_contract=failed reason=$1" >&2
  exit 1
}

sh -n "$script" || fail invalid-shell-syntax
grep -Fq 'ATHENA_ROTATE_AUTH_SECRET' "$script" || fail missing-explicit-rotation-confirmation
grep -Fq 'openssl rand -hex 48 > "$secret_file"' "$script" || fail missing-high-entropy-secret
grep -Fq 'chmod 600 "$backup_file"' "$script" || fail missing-private-backup-mode
grep -Fq 'BETTER_AUTH_URL=https://' "$script" || fail missing-https-origin
grep -Fq 'ATHENA_AUTH_COOKIE_SECURE=true' "$script" || fail missing-secure-cookie
grep -Fq 'ATHENA_PROD_HTTPS_PORT=443' "$script" || fail missing-https-port
grep -Fq 'ATHENA_AUTH_PUBLIC_HTTPS_PORT=443' "$script" || fail missing-browser-https-port

test_dir=$(mktemp -d)
cleanup() {
  rm -rf -- "$test_dir"
}
trap cleanup EXIT HUP INT TERM

environment_file="$test_dir/prod.env"
printf '%s\n' \
  'BETTER_AUTH_SECRET=known-test-placeholder' \
  'BETTER_AUTH_URL=http://vault.example.test' \
  'ATHENA_AUTH_COOKIE_SECURE=false' \
  'ATHENA_PROD_BIND_HOST=127.0.0.1' \
  'ATHENA_PROD_HTTP_PORT=80' \
  'ATHENA_PRIVATE_HOSTNAME=vault.example.test' \
  'UNCHANGED_VALUE=preserved' > "$environment_file"
ATHENA_ROTATE_AUTH_SECRET=true sh "$script" "$environment_file" >/dev/null

secret_length=$(sed -n 's/^BETTER_AUTH_SECRET=//p' "$environment_file" | tail -n 1 | wc -c | tr -d ' ')
# wc includes the trailing newline: 96 hex characters plus one newline.
[ "$secret_length" = 97 ] || fail invalid-generated-secret-length
grep -Fqx 'BETTER_AUTH_URL=https://vault.example.test' "$environment_file" || fail generated-origin-mismatch
grep -Fqx 'ATHENA_AUTH_COOKIE_SECURE=true' "$environment_file" || fail generated-cookie-mismatch
grep -Fqx 'ATHENA_PROD_HTTPS_PORT=443' "$environment_file" || fail generated-port-mismatch
grep -Fqx 'ATHENA_AUTH_PUBLIC_HTTPS_PORT=443' "$environment_file" || fail generated-browser-port-mismatch
grep -Fqx 'UNCHANGED_VALUE=preserved' "$environment_file" || fail unrelated-value-changed
[ "$(find "$test_dir" -name 'prod.env.pre-https-*' | wc -l | tr -d ' ')" = 1 ] || fail rollback-copy-missing

if ATHENA_ROTATE_AUTH_SECRET=true sh "$script" "$environment_file" 2>"$test_dir/retry.err"; then
  fail repeated-transition-not-refused
fi
grep -Fq 'reason=already-enabled' "$test_dir/retry.err" || fail repeated-transition-wrong-error

echo 'enable_private_https_contract=status=passed'
