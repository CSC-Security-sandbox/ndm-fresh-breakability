#!/usr/bin/env bash
# scripts/build-and-test.sh — build (tsc/nest/vite) and unit-test every
# service and shared library in this monorepo.
#
# Per docs/ARCHITECTURE.md (Recommended Folder Structure → "/scripts"),
# the root scripts/ folder is the canonical home for build/dev
# orchestration:
#   - scripts/install-deps.sh      : developer convenience — `npm ci`
#                                    across every service / lib
#   - scripts/build-and-test.sh    : THIS SCRIPT — actually builds and
#                                    runs unit tests
#
# Argument parsing intentionally mirrors
# app-deployment/local-deployment/bin/build.sh:
#   - long flags + a single positional TARGET
#   - --clean / --help/-h match in spelling and behavior where it makes
#     sense for source builds rather than Docker image builds
#
# Defaults: build + unit-test every npm package. Linting and coding-
# standards (Prettier --check) are opt-in via --lint / --check-format
# (or --all-checks). When enabled, those passes are non-blocking: they
# report warnings but never change the script's exit status. Build and
# test failures *are* blocking.
#
# Out of scope (for now):
#   - Maven (services/keycloak-customizations/pom.xml)
#   - Go modules (ndm-api-tests/, app-deployment/wasm/redis-jwt-auth/)
#   These are tracked in scripts/install-deps.sh's "Out of scope" comment
#   and should land alongside the dependency-resolution support there.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# All known npm targets (services + shared libs). Keep paths relative so
# the summary output stays readable.
all_targets=(
  "lib/api-handler-lib"
  "lib/auth-lib"
  "lib/jobs-lib"
  "lib/logger-lib"
  "services/admin-service"
  "services/config-service"
  "services/datamigrator-ui"
  "services/db-writer"
  "services/jobs-service"
  "services/reports-service"
  "services/support-service"
  "services/worker"
)

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS] [TARGET]

Build and unit-test every service and shared library in this monorepo.

OPTIONS:
  --install-deps          Run scripts/install-deps.sh --build-deps first
                          (npm ci across every service with a lockfile).
  --clean                 Remove each target's dist/ and coverage/ before
                          building. Does NOT remove node_modules/.
  --skip-build            Skip the build phase.
  --skip-test             Skip the test phase.
  --lint                  Run \`npm run lint\` per target (non-blocking).
  --check-format          Run \`prettier --check\` per target (non-blocking).
  --all-checks            Shortcut for --lint --check-format.
  --quiet                 Suppress per-target progress output.
  --help, -h              Show this help message.

ARGUMENTS:
  TARGET                  Build/test only the specified target. Either a
                          relative path (e.g. \`services/worker\`) or
                          the bare name (e.g. \`worker\`, \`jobs-lib\`).
                          Default: all targets.

EXAMPLES:
  # Build + unit-test every service + lib
  ./scripts/build-and-test.sh

  # Resolve deps first, then build/test/lint/format-check the lot
  ./scripts/build-and-test.sh --install-deps --all-checks

  # One service only
  ./scripts/build-and-test.sh worker

  # Clean rebuild + tests for one service
  ./scripts/build-and-test.sh --clean services/admin-service

KNOWN TARGETS:
$(printf '  %s\n' "${all_targets[@]}")

EXIT STATUS:
  0  build + tests succeeded for every selected target.
  1  build or tests failed for at least one target.
     (lint / format-check failures are reported but do not affect exit.)
EOF
  exit 0
}

# Defaults
install_deps=false
clean_build=false
skip_build=false
skip_test=false
do_lint=false
do_format_check=false
quiet=false
parsed_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-deps)  install_deps=true; shift ;;
    --clean)         clean_build=true; shift ;;
    --skip-build)    skip_build=true; shift ;;
    --skip-test)     skip_test=true; shift ;;
    --lint)          do_lint=true; shift ;;
    --check-format)  do_format_check=true; shift ;;
    --all-checks)    do_lint=true; do_format_check=true; shift ;;
    --quiet)         quiet=true; shift ;;
    --help|-h)       usage ;;
    -*)
      echo "Error: unknown option $1" >&2
      echo "Use --help for usage information" >&2
      exit 1
      ;;
    *)
      parsed_args+=("$1")
      shift
      ;;
  esac
done

log()  { if ! $quiet; then echo "$@"; fi; }
warn() { echo "$@" >&2; }

# Resolve a TARGET argument (path or bare name) to an entry in
# all_targets. Echoes the resolved relative path on success.
resolve_target() {
  local arg="$1"
  for t in "${all_targets[@]}"; do
    if [[ "${arg}" == "${t}" || "${arg}" == "$(basename "${t}")" ]]; then
      echo "${t}"
      return 0
    fi
  done
  if [[ -d "${REPO_ROOT}/${arg}" && -f "${REPO_ROOT}/${arg}/package.json" ]]; then
    echo "${arg}"
    return 0
  fi
  return 1
}

if [[ ${#parsed_args[@]} -eq 0 ]]; then
  targets=( "${all_targets[@]}" )
elif [[ ${#parsed_args[@]} -eq 1 ]]; then
  if resolved=$(resolve_target "${parsed_args[0]}"); then
    targets=( "${resolved}" )
    log "Filtering to single target: ${resolved}"
  else
    warn "Error: unknown TARGET '${parsed_args[0]}'"
    warn "Known targets:"
    for t in "${all_targets[@]}"; do warn "  ${t}"; done
    exit 1
  fi
else
  warn "Error: too many positional arguments: ${parsed_args[*]}"
  warn "Use --help for usage information"
  exit 1
fi

# Helpers ---------------------------------------------------------------

# True if package.json[scripts][NAME] exists and is non-empty.
has_npm_script() {
  local pkg_dir="$1"; local script_name="$2"
  PKG_DIR="${pkg_dir}" SCRIPT_NAME="${script_name}" node -e '
    try {
      const p = require(process.env.PKG_DIR + "/package.json");
      const v = (p.scripts || {})[process.env.SCRIPT_NAME];
      process.exit(v ? 0 : 1);
    } catch (e) { process.exit(1); }
  ' >/dev/null 2>&1
}

# True if package.json's "test" script is the npm-init placeholder
# `echo "Error: no test specified" && exit 1`. Treat as "no tests".
is_test_placeholder() {
  local pkg_dir="$1"
  PKG_DIR="${pkg_dir}" node -e '
    try {
      const p = require(process.env.PKG_DIR + "/package.json");
      const v = (p.scripts || {}).test || "";
      process.exit(/no test specified/.test(v) ? 0 : 1);
    } catch (e) { process.exit(1); }
  ' >/dev/null 2>&1
}

has_dev_dep() {
  local pkg_dir="$1"; local dep="$2"
  PKG_DIR="${pkg_dir}" DEP="${dep}" node -e '
    try {
      const p = require(process.env.PKG_DIR + "/package.json");
      const dep = process.env.DEP;
      const found = (p.devDependencies || {})[dep] || (p.dependencies || {})[dep];
      process.exit(found ? 0 : 1);
    } catch (e) { process.exit(1); }
  ' >/dev/null 2>&1
}

# Optional pre-step: install dependencies via the existing sibling script
if $install_deps; then
  log "==> scripts/install-deps.sh --build-deps"
  if $quiet; then
    "${SCRIPT_DIR}/install-deps.sh" --build-deps --quiet
  else
    "${SCRIPT_DIR}/install-deps.sh" --build-deps
  fi
fi

# Trackers --------------------------------------------------------------
build_failures=()
test_failures=()
lint_warnings=()
format_warnings=()
skipped_no_build=()
skipped_no_test=()
skipped_no_lint=()
skipped_no_format=()

# Per-target loop -------------------------------------------------------
for rel in "${targets[@]}"; do
  pkg_dir="${REPO_ROOT}/${rel}"
  if [[ ! -f "${pkg_dir}/package.json" ]]; then
    log "==> ${rel}: no package.json; skipping"
    continue
  fi

  log ""
  log "==================================================================="
  log "  ${rel}"
  log "==================================================================="

  if $clean_build; then
    log "  - cleaning dist/ coverage/"
    rm -rf "${pkg_dir}/dist" "${pkg_dir}/coverage"
  fi

  # -- Build (blocking) -------------------------------------------------
  if ! $skip_build; then
    if has_npm_script "${pkg_dir}" "build"; then
      log "  - npm run build"
      if ! ( cd "${pkg_dir}" && npm run --silent build ); then
        warn "::error::build failed for ${rel}"
        build_failures+=("${rel}")
      fi
    else
      log "  - skip build (no \"build\" script)"
      skipped_no_build+=("${rel}")
    fi
  fi

  # -- Unit tests (blocking, but missing tests are not a failure) -------
  if ! $skip_test; then
    if has_npm_script "${pkg_dir}" "test" && ! is_test_placeholder "${pkg_dir}"; then
      log "  - npm test"
      if ! ( cd "${pkg_dir}" && npm test --silent ); then
        warn "::error::tests failed for ${rel}"
        test_failures+=("${rel}")
      fi
    else
      log "  - skip test (no real \"test\" script)"
      skipped_no_test+=("${rel}")
    fi
  fi

  # -- Lint (non-blocking) ----------------------------------------------
  if $do_lint; then
    if has_npm_script "${pkg_dir}" "lint"; then
      log "  - npm run lint (non-blocking)"
      if ! ( cd "${pkg_dir}" && npm run --silent lint ); then
        warn "::warning::lint failed for ${rel} (non-blocking)"
        lint_warnings+=("${rel}")
      fi
    else
      log "  - skip lint (no \"lint\" script)"
      skipped_no_lint+=("${rel}")
    fi
  fi

  # -- Coding-standards / Prettier --check (non-blocking) ---------------
  if $do_format_check; then
    if has_dev_dep "${pkg_dir}" "prettier"; then
      log "  - prettier --check (non-blocking)"
      # Patterns mirror per-service "format" scripts; tolerate "no files
      # matched" so libraries with only a top-level src/index.ts still pass.
      if ! ( cd "${pkg_dir}" && npx --no-install prettier --check \
              --ignore-unknown \
              "src/**/*.{ts,tsx,js,jsx}" \
              "test/**/*.{ts,tsx,js,jsx}" \
              2>&1 \
            | grep -v "^\\[warn\\] No matching files" || true ); then
        :
      fi
      # Re-run to actually capture exit status (the previous block was
      # purely for output filtering). Use a separate invocation so a clean
      # repo doesn't print noisy "[warn] No matching files" lines.
      if ! ( cd "${pkg_dir}" && npx --no-install prettier --check \
              --ignore-unknown \
              --log-level warn \
              "src/**/*.{ts,tsx,js,jsx}" \
              "test/**/*.{ts,tsx,js,jsx}" \
              >/dev/null 2>&1 ); then
        warn "::warning::prettier --check failed for ${rel} (non-blocking)"
        format_warnings+=("${rel}")
      fi
    else
      log "  - skip format check (prettier not installed)"
      skipped_no_format+=("${rel}")
    fi
  fi
done

# Summary ---------------------------------------------------------------
echo ""
echo "==================================================================="
echo "  Summary"
echo "==================================================================="
printf '  Targets:                         %d\n' "${#targets[@]}"
printf '  Build failures (BLOCKING):       %d\n' "${#build_failures[@]}"
printf '  Test failures  (BLOCKING):       %d\n' "${#test_failures[@]}"
if $do_lint; then
  printf '  Lint warnings  (non-blocking):   %d\n' "${#lint_warnings[@]}"
fi
if $do_format_check; then
  printf '  Format warnings (non-blocking):  %d\n' "${#format_warnings[@]}"
fi

print_list() {
  local label="$1"; shift
  [[ $# -gt 0 ]] || return 0
  printf '  %s:\n' "${label}"
  for it in "$@"; do printf '    - %s\n' "${it}"; done
}

[[ ${#build_failures[@]} -gt 0 ]] && print_list "Build failures" "${build_failures[@]}"
[[ ${#test_failures[@]}  -gt 0 ]] && print_list "Test failures"  "${test_failures[@]}"
if $do_lint         && [[ ${#lint_warnings[@]}   -gt 0 ]]; then print_list "Lint warnings"   "${lint_warnings[@]}";   fi
if $do_format_check && [[ ${#format_warnings[@]} -gt 0 ]]; then print_list "Format warnings" "${format_warnings[@]}"; fi

if ! $skip_build  && [[ ${#skipped_no_build[@]}  -gt 0 ]]; then print_list "Skipped (no build script)"   "${skipped_no_build[@]}";  fi
if ! $skip_test   && [[ ${#skipped_no_test[@]}   -gt 0 ]]; then print_list "Skipped (no test script)"    "${skipped_no_test[@]}";   fi
if $do_lint         && [[ ${#skipped_no_lint[@]}   -gt 0 ]]; then print_list "Skipped (no lint script)"    "${skipped_no_lint[@]}";   fi
if $do_format_check && [[ ${#skipped_no_format[@]} -gt 0 ]]; then print_list "Skipped (no prettier dep)"   "${skipped_no_format[@]}"; fi

if [[ ${#build_failures[@]} -gt 0 || ${#test_failures[@]} -gt 0 ]]; then
  if ! $install_deps; then
    warn ""
    warn "Hint: if failures are 'cannot find module', try re-running with --install-deps."
  fi
  exit 1
fi

exit 0
