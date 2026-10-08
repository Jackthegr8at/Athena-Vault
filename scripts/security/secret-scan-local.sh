#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s [PATH]\n' "${0##*/}" >&2
  printf '  PATH defaults to the current working directory.\n' >&2
  exit 2
}

normalize_file() {
  local file="$1"
  file="${file#./}"
  if [[ "$file" == "$project_root/"* ]]; then
    file="${file#"$project_root/"}"
  fi
  printf '%s\n' "$file"
}

is_allowed_finding() {
  local file="$1" secret="$2"
  local normalized_file entry_path entry_placeholder
  normalized_file="$(normalize_file "$file")"

  while IFS=$'\t' read -r entry_path entry_placeholder; do
    entry_placeholder="${entry_placeholder%$'\r'}"
    [[ "$entry_path" == \#* || -z "$entry_path" ]] && continue
    if [[ "$normalized_file" == "$entry_path" && "$secret" == "$entry_placeholder" ]]; then
      return 0
    fi
  done < "$allowlist"
  return 1
}

count_disallowed_findings() {
  local report="$1"
  local count=0
  local file secret

  while IFS=$'\t' read -r file secret; do
    if ! is_allowed_finding "$file" "$secret"; then
      count=$((count + 1))
    fi
  done < <(jq -r '.[] | [(.File // ""), (.Secret // "")] | @tsv' "$report")
  printf '%s\n' "$count"
}

validate_report() {
  local report="$1"
  jq -e 'type == "array"' "$report" >/dev/null 2>&1 || {
    printf 'secret-scan: gitleaks produced an invalid JSON report\n' >&2
    exit 2
  }
}

run_gitleaks() {
  local source="$1" report="$2" mode="${3:-files}" rc
  local -a scan_args=()
  if [[ "$mode" == "files" ]]; then
    scan_args+=(--no-git)
  elif [[ "$mode" != "history" ]]; then
    printf 'secret-scan: unknown scan mode\n' >&2
    exit 2
  fi

  set +e
  gitleaks detect "${scan_args[@]}" -s "$source" --no-banner --report-format json --report-path "$report" >/dev/null 2>&1
  rc=$?
  set -e
  # Gitleaks returns 1 when findings exist; that is input for our reviewed
  # allowlist rather than a scanner failure.
  if [[ "$rc" -gt 1 ]]; then
    printf 'secret-scan: gitleaks failed with exit code %d\n' "$rc" >&2
    exit 2
  fi
}

main() {
  local target="${1:-.}"
  if [[ "$target" == "-h" || "$target" == "--help" ]]; then
    usage
  fi

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  project_root="$(cd "$script_dir/../.." && pwd)"
  local allowlist="$script_dir/secret-scan-allowlist.txt"

  if ! command -v gitleaks >/dev/null 2>&1; then
    printf 'secret-scan: required tool "gitleaks" is not installed\n' >&2
    exit 2
  fi

  if ! command -v jq >/dev/null 2>&1; then
    printf 'secret-scan: required tool "jq" is not installed\n' >&2
    exit 2
  fi

  if [[ ! -f "$allowlist" ]]; then
    printf 'secret-scan: allowlist not found: %s\n' "$allowlist" >&2
    exit 2
  fi
  # The allowlist is a reviewed list of exact file/placeholder pairs. Reject
  # malformed, generic, or whole-directory entries before scanning.
  local allowed_file allowed_placeholder extra
  while IFS=$'\t' read -r allowed_file allowed_placeholder extra; do
    allowed_placeholder="${allowed_placeholder%$'\r'}"
    [[ "$allowed_file" == \#* ]] && continue
    [[ -z "$allowed_file" && -z "$allowed_placeholder" && -z "$extra" ]] && continue
    if [[ -z "$allowed_file" || -z "$allowed_placeholder" || -n "$extra" ]]; then
      printf 'secret-scan: malformed allowlist entry\n' >&2
      exit 2
    fi
    case "$allowed_placeholder" in
      *'*'*|*'?'*|*'['*|*']'*)
        printf 'secret-scan: wildcard placeholder is not allowed\n' >&2
        exit 2
        ;;
    esac
    if [[ "$allowed_file" == /* || "$allowed_file" == */ || "$allowed_file" == "." || "$allowed_file" == ".." || ! -f "$project_root/$allowed_file" ]]; then
      printf 'secret-scan: allowlist entry is not an exact existing repository file\n' >&2
      exit 2
    fi
  done < "$allowlist"

  tmp_canary_dir="$(mktemp -d)"
  report_file="$(mktemp)"

  cleanup() {
    rm -rf "$tmp_canary_dir"
    rm -f "$report_file"
  }
  trap cleanup EXIT

  # Synthetic high-entropy GitHub-shaped canary in a non-allowed path.
  # Generate it from shell expansions so the full token is not present in this file.
  local canary_suffix canary
  canary_suffix="$(printf '%s ' {a..z} {0..9} | tr -d ' ')"
  canary="ghp_${canary_suffix}"
  printf '%s\n' "$canary" > "$tmp_canary_dir/canary.txt"

  # Gitleaks returns 1 for findings; the helper accepts that result and
  # evaluates the report against the reviewed exact-pair allowlist.
  run_gitleaks "$tmp_canary_dir" "$report_file"
  validate_report "$report_file"
  local raw_count
  raw_count="$(jq 'length' "$report_file")"
  if [[ "$raw_count" -lt 1 ]]; then
    printf 'secret-scan: synthetic canary was not detected — gitleaks is misconfigured\n' >&2
    exit 1
  fi

  local canary_after
  canary_after="$(count_disallowed_findings "$report_file")"
  if [[ "$canary_after" -lt 1 ]]; then
    printf 'secret-scan: synthetic canary disappeared after applying the reviewed allowlist\n' >&2
    exit 1
  fi

  # Scan the current files independently from repository history.
  run_gitleaks "$target" "$report_file" files
  validate_report "$report_file"
  local total
  total="$(count_disallowed_findings "$report_file")"
  if [[ "$total" -gt 0 ]]; then
    printf 'secret-scan: %d finding(s) detected\n' "$total" >&2
    jq -r '.[] | "  \(.File):\(.StartLine // "?") \(.RuleID)"' "$report_file" >&2
    exit 1
  fi

  # Also scan committed history when the target is a Git working tree.
  if [[ -d "$target" ]] && git -C "$target" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    run_gitleaks "$target" "$report_file" history
    validate_report "$report_file"
    total="$(count_disallowed_findings "$report_file")"
    if [[ "$total" -gt 0 ]]; then
      printf 'secret-scan: %d Git-history finding(s) detected\n' "$total" >&2
      jq -r '.[] | "  \(.File):\(.StartLine // "?") \(.RuleID)"' "$report_file" >&2
      exit 1
    fi
  fi

  printf 'secret-scan: no findings\n' >&2
}

main "$@"
