#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s IMAGE_REF\n' "${0##*/}" >&2
  printf '  IMAGE_REF must be an immutable digest reference: name@sha256:<64-hex>\n' >&2
  exit 2
}

validate_ref() {
  local ref="$1"
  if [[ ! "$ref" =~ ^[^@[:space:]]+@sha256:[a-fA-F0-9]{64}$ ]]; then
    printf 'sbom-check: invalid image reference (must be name@sha256:<64-hex-digest>)\n' >&2
    exit 2
  fi
}

main() {
  if [[ $# -ne 1 ]]; then
    usage
  fi
  local image_ref="$1"
  validate_ref "$image_ref"

  if ! command -v trivy >/dev/null 2>&1; then
    printf 'sbom-check: required tool "trivy" is not installed\n' >&2
    exit 2
  fi
  if ! command -v jq >/dev/null 2>&1; then
    printf 'sbom-check: required tool "jq" is not installed\n' >&2
    exit 2
  fi

  tmp_file="$(mktemp)"
  cleanup() { rm -f "$tmp_file"; }
  trap cleanup EXIT

  local rc
  set +e
  trivy image --format spdx-json --output "$tmp_file" --no-progress "$image_ref" >/dev/null 2>&1
  rc=$?
  set -e

  if [[ $rc -ne 0 ]]; then
    printf 'sbom-check: trivy SBOM generation failed (exit %d)\n' "$rc" >&2
    exit $rc
  fi

  if ! jq -e 'type == "object" and (.packages | type == "array")' "$tmp_file" >/dev/null 2>&1; then
    printf 'sbom-check: generated SBOM is empty or malformed\n' >&2
    exit 1
  fi

  printf 'sbom-check: SBOM generated and validated for %s\n' "${image_ref%%@*}" >&2
}

main "$@"
