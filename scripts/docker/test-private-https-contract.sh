#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
caddyfile="$project_root/infrastructure/docker/Caddyfile"
compose_file="$project_root/docker-compose.prod.yml"
example_env="$project_root/.env.docker.example"
compose_verifier="$project_root/scripts/docker/verify-compose-private-https.py"
dockerfile="$project_root/Dockerfile"

fail() {
  echo "private_https_contract=failed reason=$1" >&2
  exit 1
}

assert_contains() {
  file=$1
  pattern=$2
  reason=$3
  grep -Fq -- "$pattern" "$file" || fail "$reason"
}

assert_not_contains() {
  file=$1
  pattern=$2
  reason=$3
  if grep -Fq -- "$pattern" "$file"; then
    fail "$reason"
  fi
}

assert_contains "$caddyfile" 'https://{$ATHENA_PRIVATE_HOSTNAME}' missing-https-site
assert_contains "$caddyfile" 'tls internal' missing-internal-ca
assert_contains "$caddyfile" 'skip_install_trust' missing-container-trust-skip
assert_contains "$caddyfile" 'redir https://{$ATHENA_PRIVATE_HOSTNAME}:{$ATHENA_PROD_HTTPS_PORT}{uri} permanent' missing-http-redirect
assert_contains "$caddyfile" 'X-Athena-Proxy-Source "{$ATHENA_PROD_CADDY_INTERNAL_IP}"' missing-proxy-source-marker
assert_contains "$caddyfile" 'X-Forwarded-For "{remote_host}, {$ATHENA_PROD_CADDY_INTERNAL_IP}"' missing-controlled-forwarded-for
assert_contains "$caddyfile" 'header_up -X-Real-*' missing-real-ip-strip
assert_contains "$caddyfile" 'header_up X-Forwarded-Port {$ATHENA_AUTH_PUBLIC_HTTPS_PORT}' missing-forwarded-port
assert_contains "$compose_file" 'ATHENA_PROD_HTTPS_PORT:-8443' missing-https-publish
assert_contains "$compose_file" 'ATHENA_PROD_HTTPS_PORT: ${ATHENA_PROD_HTTPS_PORT:-8443}' missing-caddy-redirect-port
assert_contains "$compose_file" 'ATHENA_AUTH_PUBLIC_HTTPS_PORT: ${ATHENA_AUTH_PUBLIC_HTTPS_PORT:-443}' missing-browser-https-port
assert_contains "$compose_file" 'ATHENA_PROD_CADDY_INTERNAL_IP: ${ATHENA_PROD_CADDY_INTERNAL_IP:?ATHENA_PROD_CADDY_INTERNAL_IP must be set in the Docker environment file}' missing-caddy-internal-ip
assert_contains "$compose_file" 'target: 443' missing-container-https-port
assert_contains "$compose_file" 'ATHENA_PRIVATE_HOSTNAME must be set in the Docker environment file}:127.0.0.1' missing-healthcheck-host-map
assert_contains "$compose_file" 'https://$${ATHENA_PRIVATE_HOSTNAME}:443/api/health' missing-https-healthcheck
assert_contains "$compose_file" '--header \"Host: $${ATHENA_PRIVATE_HOSTNAME}:$${ATHENA_AUTH_PUBLIC_HTTPS_PORT}\"' missing-caddy-healthcheck-host
assert_contains "$compose_file" '--header \"X-Athena-Proxy-Source: $${ATHENA_PROD_CADDY_INTERNAL_IP}\"' missing-caddy-healthcheck-marker
assert_contains "$compose_file" '--header \"X-Forwarded-For: $${ATHENA_PROD_CADDY_INTERNAL_IP}\"' missing-caddy-healthcheck-forwarded-for
assert_contains "$compose_file" '--header \"X-Forwarded-Host: $${ATHENA_PRIVATE_HOSTNAME}:$${ATHENA_AUTH_PUBLIC_HTTPS_PORT}\"' missing-caddy-healthcheck-forwarded-host
assert_contains "$compose_file" '--header \"X-Forwarded-Port: $${ATHENA_AUTH_PUBLIC_HTTPS_PORT}\"' missing-caddy-healthcheck-forwarded-port
assert_contains "$compose_file" 'ipv4_address: ${ATHENA_PROD_CADDY_INTERNAL_IP:?ATHENA_PROD_CADDY_INTERNAL_IP must be set in the Docker environment file}' missing-caddy-static-ip
assert_contains "$compose_file" 'subnet: ${ATHENA_PROD_INTERNAL_SUBNET:?ATHENA_PROD_INTERNAL_SUBNET must be set in the Docker environment file}' missing-internal-subnet
assert_contains "$compose_file" 'ip_range: ${ATHENA_PROD_INTERNAL_IP_RANGE:?ATHENA_PROD_INTERNAL_IP_RANGE must be set in the Docker environment file}' missing-internal-ip-range
assert_contains "$compose_file" 'BETTER_AUTH_URL: ${BETTER_AUTH_URL:?BETTER_AUTH_URL must be set in the Docker environment file}' missing-required-auth-url
assert_contains "$compose_file" 'ATHENA_AUTH_COOKIE_SECURE: ${ATHENA_AUTH_COOKIE_SECURE:?ATHENA_AUTH_COOKIE_SECURE must be set in the Docker environment file}' missing-required-secure-cookie
assert_contains "$compose_file" 'ATHENA_AUTH_TRUSTED_PROXY_IPS: ${ATHENA_AUTH_TRUSTED_PROXY_IPS:?ATHENA_AUTH_TRUSTED_PROXY_IPS must be set in the Docker environment file}' missing-required-trusted-proxies
assert_contains "$compose_file" 'ATHENA_PASSKEYS_ENABLED: ${ATHENA_PASSKEYS_ENABLED:?ATHENA_PASSKEYS_ENABLED must be set in the Docker environment file}' missing-required-passkeys-flag
assert_contains "$dockerfile" 'ARG BETTER_AUTH_URL=http://localhost:3000' missing-build-auth-url
assert_contains "$dockerfile" 'ARG ATHENA_AUTH_TRUSTED_ORIGINS=' missing-build-trusted-origins
assert_contains "$dockerfile" 'ARG ATHENA_AUTH_TRUSTED_PROXY_IPS=none' missing-build-trusted-proxies
assert_contains "$dockerfile" 'ARG ATHENA_PASSKEYS_ENABLED=false' missing-build-passkeys-flag
assert_contains "$dockerfile" 'ATHENA_PASSKEYS_ENABLED=${ATHENA_PASSKEYS_ENABLED}' missing-build-passkeys-env
assert_not_contains "$compose_file" 'ATHENA_PROD_CADDY_PIDS' caddy-pid-cap-reintroduced
assert_contains "$example_env" 'BETTER_AUTH_URL=https://localhost:8443' missing-https-auth-origin
assert_contains "$example_env" 'ATHENA_AUTH_COOKIE_SECURE=true' missing-secure-cookie-example
assert_contains "$example_env" 'ATHENA_AUTH_TRUSTED_PROXY_IPS=172.29.100.2' missing-trusted-proxy-example
assert_contains "$compose_verifier" '--hostname' missing-hostname-arg
assert_contains "$compose_verifier" '--proxy-source' missing-proxy-source-arg
assert_contains "$compose_verifier" '--origin-https-port' missing-origin-port-arg
assert_contains "$compose_verifier" 'private-service-published' missing-private-service-check
assert_contains "$compose_verifier" 'unexpected-caddy-ports' missing-caddy-port-check
assert_contains "$caddyfile" 'health_headers {' missing-caddy-health-headers
assert_contains "$caddyfile" 'X-Athena-Proxy-Source {$ATHENA_PROD_CADDY_INTERNAL_IP}' missing-caddy-health-marker
assert_contains "$caddyfile" 'X-Forwarded-For {$ATHENA_PROD_CADDY_INTERNAL_IP}' missing-caddy-health-forwarded-for
assert_contains "$caddyfile" 'X-Forwarded-Host {$ATHENA_PRIVATE_HOSTNAME}:{$ATHENA_AUTH_PUBLIC_HTTPS_PORT}' missing-caddy-health-forwarded-host
assert_contains "$caddyfile" 'X-Forwarded-Proto https' missing-caddy-health-forwarded-proto
assert_contains "$caddyfile" 'X-Forwarded-Port {$ATHENA_AUTH_PUBLIC_HTTPS_PORT}' missing-caddy-health-forwarded-port
assert_contains "$compose_file" 'X-Athena-Proxy-Source' missing-web-health-marker
assert_contains "$compose_file" "'X-Forwarded-For':proxySource" missing-web-health-forwarded-for
assert_contains "$compose_file" "'X-Forwarded-Host':url.host" missing-web-health-forwarded-host
assert_contains "$compose_file" "'X-Forwarded-Proto':url.protocol.slice(0,-1)" missing-web-health-forwarded-proto
assert_contains "$compose_file" "'X-Forwarded-Port':url.port" missing-web-health-forwarded-port
assert_contains "$compose_verifier" 'ATHENA_PRIVATE_HOSTNAME' missing-verifier-hostname-check
assert_contains "$compose_verifier" 'ATHENA_PROD_HTTPS_PORT' missing-verifier-port-key

echo 'private_https_contract=status=passed'
