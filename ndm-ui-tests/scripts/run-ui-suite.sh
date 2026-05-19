#!/usr/bin/env bash
# run-ui-suite.sh <suite-name> [test-plan.yaml]
#
# Reads test-plan.yaml with awk, builds the -run regex for the requested suite,
# runs `go test`, captures output, and generates a Teams-ready report.
#
# Usage (from the ndm-ui-tests directory):
#   ./scripts/run-ui-suite.sh discovery
#   ./scripts/run-ui-suite.sh user_management
#   ./scripts/run-ui-suite.sh discovery /path/to/other-plan.yaml
#
# Exit codes:
#   0  all enabled tests passed (or suite disabled / no tests enabled)
#   1  one or more tests failed
#   2  bad arguments or plan file not found

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUITE="${1:-}"
PLAN="${2:-${SCRIPT_DIR}/../test-plan.yaml}"

# ── Validate ──────────────────────────────────────────────────────────────────
if [[ -z "$SUITE" ]]; then
  echo "Usage: $0 <suite-name> [test-plan.yaml]" >&2
  echo "Example suites: discovery  user_management" >&2
  exit 2
fi

if [[ ! -f "$PLAN" ]]; then
  echo "ERROR: test plan not found: $PLAN" >&2
  exit 2
fi

# ── Parse test-plan.yaml with awk ─────────────────────────────────────────────
# Capture awk output into a variable first, then split with a here-string.
# This avoids the `read < <(...)` pattern where `read` returns exit code 1 at
# EOF under `set -e`, which would silently abort the script before go test runs.
#
_awk_out=$(awk -v target="$SUITE" '
  {
    orig = $0
    stripped = orig
    gsub(/^[ \t]*/, "", stripped)
    if (stripped == "") next

    indent = length(orig) - length(stripped)

    if (indent == 2) {
      split(stripped, a, ":"); current = a[1]; in_tests = 0; next
    }

    if (current != target) next

    if (indent == 4) {
      sub(/ *#.*$/, "", stripped)
      split(stripped, a, /: */); key = a[1]; val = a[2]
      if      (key == "enabled")  enabled  = (val == "true") ? "true" : "false"
      else if (key == "parallel") parallel = val + 0
      else if (key == "timeout")  timeout  = val
      else if (key == "tests")    in_tests = 1
      next
    }

    if (indent == 6 && in_tests && stripped ~ /^Test/) {
      line_no_comment = stripped
      sub(/ *#.*$/, "", line_no_comment)
      colon = index(line_no_comment, ": ")
      name  = substr(line_no_comment, 1, colon - 1)
      val   = substr(line_no_comment, colon + 2)
      gsub(/^[ \t]+|[ \t]+$/, "", name)
      gsub(/^[ \t]+|[ \t]+$/, "", val)
      if (val == "true") {
        pattern = (pattern == "") ? name : pattern "|" name
      }
      next
    }
  }
  BEGIN { current=""; in_tests=0; enabled="false"; parallel=2; timeout="30m"; pattern="" }
  END   { print enabled, parallel, timeout, pattern }
  ' "$PLAN")

read -r SUITE_ENABLED PARALLEL TIMEOUT RUN_PATTERN <<< "$_awk_out" || true

# ── Check suite enabled ───────────────────────────────────────────────────────
if [[ "$SUITE_ENABLED" != "true" ]]; then
  echo "Suite '${SUITE}' is disabled in test-plan.yaml — skipping."
  exit 0
fi

if [[ -z "$RUN_PATTERN" ]]; then
  echo "Suite '${SUITE}': no tests are enabled in test-plan.yaml — skipping."
  exit 0
fi

echo "────────────────────────────────────────────────────────"
echo " Suite    : ${SUITE}"
echo " Parallel : ${PARALLEL}"
echo " Timeout  : ${TIMEOUT}"
echo " Filter   : ${RUN_PATTERN}"
echo "────────────────────────────────────────────────────────"

# ── Run tests — capture output while still streaming to terminal ──────────────
mkdir -p test-results
LOG="test-results/${SUITE}-output.log"

TEST_EXIT=0
go test -v \
  -run "${RUN_PATTERN}" \
  ./tests/ \
  -parallel "${PARALLEL}" \
  -timeout "${TIMEOUT}" \
  2>&1 | tee "$LOG" || TEST_EXIT=$?

# ── Generate report ───────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────────"
echo " Generating test report..."
echo "────────────────────────────────────────────────────────"
bash "${SCRIPT_DIR}/generate-test-report.sh" "$SUITE" "$LOG" "$PLAN" || true

# Propagate go test exit code so CI marks the step as failed when tests fail
exit "$TEST_EXIT"
