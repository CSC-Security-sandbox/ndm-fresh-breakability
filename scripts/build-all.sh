#!/usr/bin/env bash
# scripts/build-all.sh — top-level build/dependency-resolution entry point.
#
# Per docs/ARCHITECTURE.md (Priority 2.2 "Reorganize Deployment
# Configuration" → Recommended Structure → "/scripts" section), this
# is the canonical root-level entry for resolving all per-service
# dependencies. The existing app-deployment/local-deployment/bin/build.sh
# is intentionally left in place — it solves a different problem
# (Docker image build + push to ACR for the local-deploy multipass
# stack). This script is for the dependency-materialisation step that
# the RTS FTP-posting workflow needs, and that a developer would run
# locally to populate every service's node_modules / ~/.m2 / module
# cache without going near Docker.
#
# Currently implemented:
#   - npm: runs `npm ci --prefer-offline` for every service that has
#     a package-lock.json. Only does so when --build-deps is passed,
#     because the RTS workflow's source-harvester reads lockfiles
#     directly (no install required) and we don't want to pay 5+ min
#     of `npm ci` cost in CI for nothing.
#
# Deferred (matches "only implement what's necessary" in the
# user-facing brief; add when the next iteration needs them):
#   - Maven (services/keycloak-customizations/pom.xml): would run
#     `mvn -B dependency:resolve dependency:resolve-sources` to
#     populate ~/.m2/.
#   - Go modules: ndm-api-tests/, app-deployment/wasm/redis-jwt-auth/
#     have go.mod files; `go mod download` would populate
#     $GOPATH/pkg/mod/cache/.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Resolve dependencies for every service in this monorepo.

Options:
  --build-deps      Run \`npm ci\` for every service that has a
                    package-lock.json. Without this flag, the script
                    is a no-op (the RTS source-harvester reads
                    lockfiles directly and does not need an install
                    to have run).
  --quiet           Suppress per-service progress output.
  --help, -h        Show this message.

Locations:
  REPO_ROOT = ${REPO_ROOT}
EOF
  exit 0
}

build_deps=false
quiet=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-deps) build_deps=true; shift ;;
    --quiet)      quiet=true; shift ;;
    --help|-h)    usage ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

log() {
  if ! $quiet; then echo "$@"; fi
}

if ! $build_deps; then
  log "scripts/build-all.sh: nothing to do (run with --build-deps to npm ci)"
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "::warning::npm not found on PATH; skipping npm ci across services" >&2
  exit 0
fi

# Find every service-level package-lock.json (excluding any inside
# node_modules — those are nested transitives).
mapfile -t lockfiles < <(
  find "${REPO_ROOT}" \
    -name node_modules -prune -o \
    -name package-lock.json -print 2>/dev/null
)

if [[ ${#lockfiles[@]} -eq 0 ]]; then
  log "No package-lock.json files found in ${REPO_ROOT}"
  exit 0
fi

failed=()
for lock in "${lockfiles[@]}"; do
  svc_dir="$(dirname "${lock}")"
  rel="${svc_dir#${REPO_ROOT}/}"
  log "==> npm ci in ${rel}"
  if ( cd "${svc_dir}" && npm ci --prefer-offline --no-audit --no-fund ); then
    log "    ok"
  else
    echo "::warning::npm ci failed in ${rel}" >&2
    failed+=("${rel}")
  fi
done

if [[ ${#failed[@]} -gt 0 ]]; then
  echo "::error::npm ci failed for ${#failed[@]} service(s):" >&2
  for f in "${failed[@]}"; do
    echo "  - ${f}" >&2
  done
  exit 1
fi

log "scripts/build-all.sh: done (${#lockfiles[@]} service(s) installed)"
