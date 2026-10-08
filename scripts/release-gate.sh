#!/usr/bin/env bash
set -euo pipefail

# Local, fail-fast release gate.
# Runs common local checks. Optional security checks are explicit and never
# contact a remote service or perform cloud automation.

cd "$(dirname "$0")/.."

usage() {
  local exit_code="${1:-2}"
  printf 'Usage: %s [local [--with-security] | security | post-build | --help]\n' "${0##*/}" >&2
  printf '  local              run common local checks (default)\n' >&2
  printf '  local --with-security  run common checks then the local security suite\n' >&2
  printf '  security           run only the local security suite\n' >&2
  printf '  post-build         check an existing build output for environment files\n' >&2
  exit "$exit_code"
}

NEXT_ENV_FILE="apps/web/next-env.d.ts"
NEXT_ENV_BACKUP="$(mktemp)"
NEXT_ENV_PRESENT=false
if [[ -f "$NEXT_ENV_FILE" ]]; then
  NEXT_ENV_PRESENT=true
  cat "$NEXT_ENV_FILE" > "$NEXT_ENV_BACKUP"
fi

TSC_BUILD_INFO_FILE="apps/web/tsconfig.tsbuildinfo"
TSC_BUILD_INFO_BACKUP="$(mktemp)"
TSC_BUILD_INFO_PRESENT=false
if [[ -f "$TSC_BUILD_INFO_FILE" ]]; then
  TSC_BUILD_INFO_PRESENT=true
  cat "$TSC_BUILD_INFO_FILE" > "$TSC_BUILD_INFO_BACKUP"
fi

restore_generated_files() {
  if [[ "$NEXT_ENV_PRESENT" == true ]]; then
    cat "$NEXT_ENV_BACKUP" > "$NEXT_ENV_FILE"
  else
    rm -f "$NEXT_ENV_FILE"
  fi
  if [[ "$TSC_BUILD_INFO_PRESENT" == true ]]; then
    cat "$TSC_BUILD_INFO_BACKUP" > "$TSC_BUILD_INFO_FILE"
  else
    rm -f "$TSC_BUILD_INFO_FILE"
  fi
  rm -f "$NEXT_ENV_BACKUP" "$TSC_BUILD_INFO_BACKUP"
}
trap restore_generated_files EXIT

run() {
  printf '==> %s\n' "$1"
}

assert_build_output_clean() {
  ATHENA_BUILD_DIST="${ATHENA_BUILD_DIST:-.next-gate}" node scripts/next-standalone-security.mjs check
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    PNPM_CMD=(pnpm)
  elif command -v corepack >/dev/null 2>&1; then
    PNPM_CMD=(corepack pnpm)
  else
    printf '%s\n' 'release gate requires pnpm or Corepack.' >&2
    exit 127
  fi
}

ensure_db_env() {
  if [[ -z "${DATABASE_URL:-}" || -z "${ATHENA_AUTH_DATABASE_URL:-}" ]]; then
    printf '%s\n' 'release gate build requires explicit disposable DATABASE_URL and ATHENA_AUTH_DATABASE_URL values.' >&2
    exit 2
  fi
}

run_local() {
  ensure_pnpm
  ensure_db_env

  run "Running typecheck..."
  "${PNPM_CMD[@]}" -r typecheck

  run "Running lint..."
  "${PNPM_CMD[@]}" --filter @athena/web lint

  run "Running tests..."
  # Unit tests own their proxy-policy fixtures; never let a configured database
  # URL turn this local gate into an unapproved live-data integration run.
  env DATABASE_URL= ATHENA_AUTH_DATABASE_URL= ATHENA_AUTH_TRUSTED_PROXY_IPS= ATHENA_DISABLE_ENV_FILE_FALLBACK=true "${PNPM_CMD[@]}" -r test

  run "Running migration catalog check..."
  "${PNPM_CMD[@]}" --filter @athena/database exec tsx ../../scripts/docker/migration-catalog.ts --format=filenames

  run "Running migration catalog tests..."
  "${PNPM_CMD[@]}" --filter @athena/database exec vitest run src/migrations/catalog.test.ts

  run "Running deployment contract checks..."
  sh scripts/docker/test-backup-contract.sh
  sh scripts/docker/test-scheduled-backup-contract.sh
  sh scripts/docker/test-private-https-contract.sh
  sh scripts/docker/test-enable-private-https-contract.sh

  run "Running production build with isolated dist directory..."
  ATHENA_BUILD_DIST=.next-gate ATHENA_DISABLE_ENV_FILE_FALLBACK=true "${PNPM_CMD[@]}" --filter @athena/web build

  run "Checking production output for environment files..."
  ATHENA_BUILD_DIST=.next-gate assert_build_output_clean

  run "Running production audit..."
  "${PNPM_CMD[@]}" audit --prod --json
}

run_security() {
  run "Running secret scan..."
  ./scripts/security/secret-scan-local.sh

  if [[ -n "${ATHENA_IMAGE_REF:-}" ]]; then
    run "Running SBOM check..."
    ./scripts/security/sbom-local.sh "$ATHENA_IMAGE_REF"
    run "Running vulnerability check..."
    ./scripts/security/image-vulnerability-local.sh "$ATHENA_IMAGE_REF"
    run "Running provenance check..."
    ./scripts/security/image-provenance-local.sh "$ATHENA_IMAGE_REF"
  fi

  if [[ -n "${ATHENA_EVENTS_FILE:-}" ]]; then
    run "Running failure-alert check..."
    ./scripts/security/failure-alert-check.sh "$ATHENA_EVENTS_FILE"
  fi
}

main() {
  local cmd="${1:-local}"
  case "$cmd" in
    -h|--help)
      usage 0
      ;;
    security)
      run_security
      ;;
    post-build)
      assert_build_output_clean
      ;;
    local)
      if [[ $# -gt 0 ]]; then
        shift
      fi
      run_local
      if [[ "${1:-}" == "--with-security" ]]; then
        run_security
      fi
      ;;
    *)
      usage
      ;;
  esac
}

main "$@"
