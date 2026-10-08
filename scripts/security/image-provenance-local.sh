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
    printf 'image-provenance-local: invalid image reference\n' >&2
    exit 2
  fi
}

validate_exact_value() {
  local name="$1" value="$2"
  if [[ -z "$value" || "$value" == *[[:space:]]* || "$value" == *'*'* || "$value" == *'?'* || "$value" == *'['* || "$value" == *']'* ]]; then
    printf 'image-provenance-local: %s must be nonempty and wildcard-free\n' "$name" >&2
    exit 2
  fi
}

main() {
  if [[ $# -ne 1 ]]; then
    usage
  fi
  local image_ref="$1"
  validate_ref "$image_ref"

  if ! command -v cosign >/dev/null 2>&1; then
    printf 'image-provenance-local: required tool "cosign" is not installed\n' >&2
    exit 2
  fi

  tmp_out="$(mktemp)"
  cleanup() { rm -f "$tmp_out"; }
  trap cleanup EXIT

  if [[ -n "${COSIGN_PUBLIC_KEY:-}" ]]; then
    local public_key_checksum approved_checksum actual_checksum
    public_key_checksum="${COSIGN_PUBLIC_KEY_SHA256:-}"
    approved_checksum="${ATHENA_APPROVED_COSIGN_PUBLIC_KEY_SHA256:-}"
    validate_exact_value "COSIGN_PUBLIC_KEY_SHA256" "$public_key_checksum"
    validate_exact_value "ATHENA_APPROVED_COSIGN_PUBLIC_KEY_SHA256" "$approved_checksum"
    if [[ ! "$public_key_checksum" =~ ^[a-fA-F0-9]{64}$ || "$public_key_checksum" != "$approved_checksum" ]]; then
      printf 'image-provenance-local: public-key checksum does not match the approved value\n' >&2
      exit 2
    fi
    actual_checksum="$(printf '%s' "$COSIGN_PUBLIC_KEY" | sha256sum | cut -d' ' -f1)"
    if [[ "$actual_checksum" != "$public_key_checksum" ]]; then
      printf 'image-provenance-local: supplied public-key checksum mismatch\n' >&2
      exit 2
    fi
    set +e
    cosign verify --key <(printf '%s' "$COSIGN_PUBLIC_KEY") "$image_ref" >"$tmp_out" 2>&1
    rc=$?
    set -e
  else
    local identity issuer approved_identity approved_issuer
    identity="${COSIGN_CERTIFICATE_IDENTITY:-}"
    issuer="${COSIGN_CERTIFICATE_OIDC_ISSUER:-}"
    approved_identity="${ATHENA_APPROVED_COSIGN_CERTIFICATE_IDENTITY:-}"
    approved_issuer="${ATHENA_APPROVED_COSIGN_CERTIFICATE_OIDC_ISSUER:-}"
    validate_exact_value "COSIGN_CERTIFICATE_IDENTITY" "$identity"
    validate_exact_value "COSIGN_CERTIFICATE_OIDC_ISSUER" "$issuer"
    validate_exact_value "ATHENA_APPROVED_COSIGN_CERTIFICATE_IDENTITY" "$approved_identity"
    validate_exact_value "ATHENA_APPROVED_COSIGN_CERTIFICATE_OIDC_ISSUER" "$approved_issuer"
    if [[ "$identity" != "$approved_identity" || "$issuer" != "$approved_issuer" ]]; then
      printf 'image-provenance-local: signer identity or issuer does not match the approved values\n' >&2
      exit 2
    fi
    set +e
    cosign verify --certificate-identity "$identity" --certificate-oidc-issuer "$issuer" "$image_ref" >"$tmp_out" 2>&1
    rc=$?
    set -e
  fi

  if [[ $rc -ne 0 ]]; then
    printf 'image-provenance-local: cosign verification failed (exit %d)\n' "$rc" >&2
    exit $rc
  fi

  printf 'image-provenance-local: provenance verified for %s\n' "${image_ref%%@*}" >&2
}

main "$@"
