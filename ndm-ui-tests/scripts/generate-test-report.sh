#!/usr/bin/env bash
# generate-test-report.sh <suite> <go-test-log> <test-plan.yaml>
#
# Parses `go test -v` output and test-plan.yaml to produce:
#   test-results/<suite>-summary.md     — markdown table (for CI logs)
#   test-results/<suite>-teams.json     — Teams MessageCard JSON (for webhook)
#
# Tools: awk, sed, date — bash 3.2+ compatible, no Python/jq required.

set -euo pipefail

SUITE="${1:-}"
LOG="${2:-}"
PLAN="${3:-}"

if [[ -z "$SUITE" || -z "$LOG" || -z "$PLAN" ]]; then
  echo "Usage: $0 <suite> <go-test-log> <test-plan.yaml>" >&2
  exit 2
fi
for f in "$LOG" "$PLAN"; do
  [[ -f "$f" ]] || { echo "ERROR: file not found: $f" >&2; exit 2; }
done

mkdir -p test-results

TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M UTC')
MD_FILE="test-results/${SUITE}-summary.md"
JSON_FILE="test-results/${SUITE}-teams.json"

# ─────────────────────────────────────────────────────────────────────────────
# Single awk pass over BOTH files:
#   FILENAME == plan  → build description map
#   FILENAME == log   → parse results and errors
# Outputs tab-separated rows: STATUS\tNAME\tDURATION\tDESCRIPTION\tERROR
# ─────────────────────────────────────────────────────────────────────────────
ROWS=$(awk -v target="$SUITE" -v plan_file="$PLAN" -v log_file="$LOG" '

# ── Plan file: build description map ─────────────────────────────────────────
FILENAME == plan_file {
  orig = $0
  stripped = orig
  gsub(/^[ \t]*/, "", stripped)
  if (stripped == "") next

  indent = length(orig) - length(stripped)

  if (indent == 2) {
    split(stripped, a, ":"); current_suite = a[1]; in_tests = 0; next
  }
  if (current_suite != target) next
  if (indent == 4 && stripped ~ /^tests:/) { in_tests = 1; next }
  if (indent == 6 && in_tests && stripped ~ /^Test/) {
    # Value (true/false) is before the #; description is the # comment
    desc = ""
    if (stripped ~ /#/) {
      desc = stripped
      sub(/^.*#[ \t]*/, "", desc)           # everything after "#"
      gsub(/[ \t]+$/, "", desc)
    }
    sub(/ *#.*$/, "", stripped)             # strip comment to get name: value
    colon = index(stripped, ": ")
    name  = substr(stripped, 1, colon - 1)
    val   = substr(stripped, colon + 2)
    gsub(/^[ \t]+|[ \t]+$/, "", name)
    gsub(/^[ \t]+|[ \t]+$/, "", val)
    if (val == "true") desc_map[name] = desc
  }
  next
}

# ── Log file: parse go test -v output ────────────────────────────────────────
FILENAME == log_file {
  # Track current test from "=== NAME  TestFoo"
  if (/^=== NAME /) {
    sub(/^=== NAME[ \t]+/, "")
    cur = $0
    gsub(/[ \t\r]+$/, "", cur)
    if (!(cur in seen)) {
      seen[cur] = 1
      errors[cur] = ""
      msgs[cur]   = ""
      got_error[cur] = 0
    }
    next
  }

  # Capture the real error after "Received unexpected error:"
  if (cur != "" && prev_was_rxue && $0 !~ /^[ \t]*(Error|Messages|Test|Error Trace):/) {
    line = $0; gsub(/^[ \t]+/, "", line); gsub(/[ \t\r]+$/, "", line)
    if (line != "" && errors[cur] == "") errors[cur] = line
    prev_was_rxue = 0
    next
  }
  prev_was_rxue = 0

  # "Error:   Received unexpected error:" — next non-label line is the real msg
  if (cur != "" && /Error:[ \t]+Received unexpected error:/) {
    prev_was_rxue = 1; next
  }

  # "Error:   <direct message>"
  if (cur != "" && /Error:[ \t]+/ && errors[cur] == "") {
    line = $0; sub(/^.*Error:[ \t]+/, "", line); gsub(/[ \t\r]+$/, "", line)
    if (line != "" && line != "Received unexpected error:") errors[cur] = line
    next
  }

  # "Messages:  <context>"
  if (cur != "" && /Messages:[ \t]+/ && msgs[cur] == "") {
    line = $0; sub(/^.*Messages:[ \t]+/, "", line); gsub(/[ \t\r]+$/, "", line)
    msgs[cur] = line
    next
  }

  # Final result line "--- PASS/FAIL/SKIP: TestFoo (1.23s)"
  if (/^--- (PASS|FAIL|SKIP):/) {
    status = substr($2, 1, length($2)-1)
    name   = $3
    dur    = $4; gsub(/[()r]/, "", dur)   # "630.62s" → "630.62s"

    err = errors[name]
    if (err == "" && msgs[name] != "") err = msgs[name]
    if (length(err) > 120) err = substr(err, 1, 117) "..."

    order[++count] = name
    results[name]  = status
    durs[name]     = dur
    errs[name]     = err
    cur = ""
    next
  }
}

BEGIN {
  current_suite = ""; in_tests = 0
  cur = ""; count = 0; prev_was_rxue = 0
}

END {
  for (i = 1; i <= count; i++) {
    n = order[i]
    print results[n] "\t" n "\t" durs[n] "\t" desc_map[n] "\t" errs[n]
  }
}
' "$PLAN" "$LOG")

# ─────────────────────────────────────────────────────────────────────────────
# Count totals
# ─────────────────────────────────────────────────────────────────────────────
PASS_COUNT=$(echo "$ROWS" | awk -F'\t' '$1=="PASS"{c++}END{print c+0}')
FAIL_COUNT=$(echo "$ROWS" | awk -F'\t' '$1=="FAIL"{c++}END{print c+0}')
SKIP_COUNT=$(echo "$ROWS" | awk -F'\t' '$1=="SKIP"{c++}END{print c+0}')
TOTAL=$(( PASS_COUNT + FAIL_COUNT + SKIP_COUNT ))
THEME_COLOR=$( [[ $FAIL_COUNT -gt 0 ]] && echo "FF0000" || echo "00B050" )

# ─────────────────────────────────────────────────────────────────────────────
# Markdown summary
# ─────────────────────────────────────────────────────────────────────────────
{
  echo "## NDM UI Tests — ${SUITE} — ${TIMESTAMP}"
  echo ""
  echo "**${TOTAL} total** | ✅ ${PASS_COUNT} passed | ❌ ${FAIL_COUNT} failed | ⏭️ ${SKIP_COUNT} skipped"
  echo ""
  echo "| Status | Test | Duration | What it tests | Error |"
  echo "|--------|------|----------|---------------|-------|"

  while IFS=$'\t' read -r status name dur desc err; do
    [[ -z "$name" ]] && continue
    case "$status" in
      PASS) icon="✅" ;; FAIL) icon="❌" ;; SKIP) icon="⏭️" ;; *) icon="❓" ;;
    esac
    echo "| ${icon} ${status} | \`${name}\` | ${dur} | ${desc} | ${err} |"
  done <<< "$ROWS"
} > "$MD_FILE"

echo "[report] markdown → ${MD_FILE}"

# ─────────────────────────────────────────────────────────────────────────────
# Teams MessageCard JSON
#   "facts" renders as a two-column table in all Teams clients.
# ─────────────────────────────────────────────────────────────────────────────
escape_json() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\r\n'
}

{
  cat <<HEAD
{
  "@type": "MessageCard",
  "@context": "http://schema.org/extensions",
  "themeColor": "${THEME_COLOR}",
  "summary": "NDM UI Tests — ${SUITE}",
  "title": "NDM UI Tests — ${SUITE}",
  "sections": [
    {
      "activityTitle": "**${SUITE}** | ✅ ${PASS_COUNT} passed  ❌ ${FAIL_COUNT} failed  ⏭️ ${SKIP_COUNT} skipped",
      "activitySubtitle": "$(escape_json "${TIMESTAMP}")",
      "facts": [
HEAD

  first=true
  while IFS=$'\t' read -r status name dur desc err; do
    [[ -z "$name" ]] && continue

    case "$status" in
      PASS) label="✅ PASS" ;; FAIL) label="❌ FAIL" ;; SKIP) label="⏭️ SKIP" ;; *) label="❓" ;;
    esac

    fact_name=$(escape_json "${label} (${dur})")

    val=$(escape_json "$name")
    [[ -n "$desc" ]] && val="${val} — $(escape_json "$desc")"
    [[ -n "$err"  ]] && val="${val}\\n⚠️ $(escape_json "$err")"

    [[ "$first" == "true" ]] && first=false || printf '        ,\n'
    printf '        {"name": "%s", "value": "%s"}\n' "$fact_name" "$val"
  done <<< "$ROWS"

  cat <<TAIL
      ]
    }
  ]
}
TAIL
} > "$JSON_FILE"

echo "[report] Teams JSON → ${JSON_FILE}"

# ─────────────────────────────────────────────────────────────────────────────
# Print the table to stdout so it appears in CI logs
# ─────────────────────────────────────────────────────────────────────────────
echo ""
cat "$MD_FILE"
