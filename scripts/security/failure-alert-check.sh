#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s [FILE]\n' "${0##*/}" >&2
  printf '  FILE is a JSON Lines file; defaults to stdin.\n' >&2
  exit 2
}

in_list() {
  local value="$1" list="$2" candidate
  while IFS= read -r candidate; do
    [[ "$candidate" == "$value" ]] && return 0
  done <<< "$list"
  return 1
}

validate_line() {
  local line="$1" line_no="$2"
  local fields mode event operation error_class status failure_code component

  if ! jq -e 'type == "object"' >/dev/null 2>&1 <<< "$line"; then
    printf 'failure-alert-check: line %d: malformed event\n' "$line_no" >&2
    return 2
  fi
  fields="$(jq -r 'keys | sort | join(",")' <<< "$line")"
  case "$fields" in
    "errorClass,event,failureCode,operation,status")
      mode="operational"
      ;;
    "component,errorClass,event,failureCode,operation,status")
      mode="security"
      ;;
    *)
      printf 'failure-alert-check: line %d: unallowlisted event fields\n' "$line_no" >&2
      return 2
      ;;
  esac

  event="$(jq -r '.event' <<< "$line")"
  operation="$(jq -r '.operation' <<< "$line")"
  error_class="$(jq -r '.errorClass' <<< "$line")"
  status="$(jq -r '.status' <<< "$line")"
  failure_code="$(jq -r '.failureCode' <<< "$line")"
  component="$(jq -r '.component // ""' <<< "$line")"

  if [[ -z "$event" || -z "$operation" || -z "$error_class" || -z "$status" || -z "$failure_code" ]]; then
    printf 'failure-alert-check: line %d: required field is empty\n' "$line_no" >&2
    return 2
  fi
  if [[ ! "$error_class" =~ ^[A-Za-z][A-Za-z0-9_]{0,63}$ ]]; then
    printf 'failure-alert-check: line %d: unsafe error class\n' "$line_no" >&2
    return 2
  fi
  if [[ ! "$failure_code" =~ ^[A-Z][A-Z0-9_]+$ ]]; then
    printf 'failure-alert-check: line %d: unsafe failure code\n' "$line_no" >&2
    return 2
  fi

  if [[ "$mode" == "operational" ]]; then
    if [[ "$event" != "operational_failure" ]] || ! in_list "$operation" "$allowed_operational_operations" || ! in_list "$status" "$allowed_operational_statuses"; then
      printf 'failure-alert-check: line %d: unallowlisted operational event\n' "$line_no" >&2
      return 2
    fi
    return 1
  fi

  if ! in_list "$event" "$allowed_security_events" ||
     ! in_list "$component" "$allowed_security_components" ||
     ! in_list "$operation" "$allowed_security_operations" ||
     ! in_list "$status" "$allowed_security_statuses" ||
     ! in_list "$failure_code" "$allowed_security_failure_codes"; then
    printf 'failure-alert-check: line %d: unallowlisted security event\n' "$line_no" >&2
    return 2
  fi
  case "$event:$component" in
    settings_security_summary_unavailable:settings|settings_session_revoke_failed:settings|auth_security_event_failed:auth)
      ;;
    *)
      printf 'failure-alert-check: line %d: event/component mismatch\n' "$line_no" >&2
      return 2
      ;;
  esac
  case "$status" in
    success) return 0 ;;
    unknown|client-error|server-error) return 1 ;;
    *) return 2 ;;
  esac
}

consume_events() {
  local line_no=0
  local has_failure=0
  local has_invalid=0
  local line line_rc

  while IFS= read -r line || [[ -n "$line" ]]; do
    line_no=$((line_no + 1))
    [[ -z "${line//[[:space:]]/}" ]] && continue
    line_rc=0
    validate_line "$line" "$line_no" || line_rc=$?
    if [[ "$line_rc" -eq 1 ]]; then
      has_failure=1
    elif [[ "$line_rc" -ne 0 ]]; then
      has_invalid=1
    fi
  done

  if [[ "$has_invalid" -ne 0 ]]; then
    exit 2
  fi
  if [[ "$has_failure" -ne 0 ]]; then
    exit 1
  fi
  printf 'failure-alert-check: %d event(s) accepted\n' "$line_no" >&2
}

main() {
  if [[ $# -gt 1 ]]; then
    usage
  fi

  local input="${1:--}"
  if ! command -v jq >/dev/null 2>&1; then
    printf 'failure-alert-check: required tool "jq" is not installed\n' >&2
    exit 2
  fi

  allowed_operational_operations=$'auth.better_auth\nauth.demo_signin\ndatabase.connect\ndatabase.configure\ndatabase.verify\nmigration.run\nbackup.scheduled\nbackup.run\nrestore.database\nrestore.production\nverify.restore\nverify.local_backup'
  allowed_operational_statuses=$'failed\nunauthorized\nforbidden\nunavailable\ninvalid\naborted\nredacted'
  allowed_security_events=$'settings_security_summary_unavailable\nsettings_session_revoke_failed\nauth_security_event_failed'
  allowed_security_components=$'settings\nauth'
  allowed_security_operations=$'load-security-summary\nrevoke-session\ntwo-factor-enable\ntwo-factor-disable\nbackup-codes-regenerate\nsession-revoke\nsession-create\npassword-change'
  allowed_security_statuses=$'unknown\nsuccess\nclient-error\nserver-error'
  allowed_security_failure_codes=$'SETTINGS_SECURITY_SUMMARY_UNAVAILABLE\nSETTINGS_SESSION_REVOKE_FAILED\nAUTH_SECURITY_EVENT_FAILED'

  if [[ "$input" == "-" ]]; then
    consume_events
    exit 0
  fi
  if [[ ! -f "$input" ]]; then
    printf 'failure-alert-check: input file not found\n' >&2
    exit 2
  fi
  consume_events < "$input"
}

main "$@"
