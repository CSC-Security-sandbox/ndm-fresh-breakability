#!/usr/bin/env bash
# scripts/install-deps.sh — developer convenience: `npm ci` across every
# service and shared library that has a package-lock.json.
#
# History: this script was previously named `scripts/build-all.sh`, which
# misleadingly implied a full source build. It does not build anything;
# it only materialises per-package node_modules/.
#
# Relationship to the RTS FTP-posting workflow: this script is NOT
# called by .github/workflows/rts-ftp-posting.yaml. The RTS source-
# harvester (scripts/rts-ftp-posting/stage-sources.py) walks every
# package-lock.json directly, reading each entry's `resolved` URL and
# `integrity` SHA-512 to fetch bit-identical tarballs from the public
# registry — it never needs node_modules/ to be populated. This script
# exists as a developer-side convenience for engineers who want to
# materialise the same world locally (e.g. to debug the harvester, or
# to run scripts/build-and-test.sh after a fresh checkout).
#
# For the actual "build every service + run unit tests" entry point,
# see scripts/build-and-test.sh (which can call this script via
# --install-deps).
#
# Intentionally separate from app-deployment/local-deployment/bin/build.sh,
# which solves a different problem (Docker image build + push to ACR for
# the local-deploy multipass stack).
#
# The --build-deps gate is kept as an explicit opt-in because this script
# can take 5+ minutes across the full monorepo on a cold cache; we don't
# want a stray invocation to silently start a long install.
#
# Out of scope for now (add as needs arise):
#   - Maven (services/keycloak-customizations/pom.xml): would run
#     `mvn -B dependency:resolve dependency:resolve-sources` to
#     populate ~/.m2/.
#   - Go modules: ndm-api-tests/, app-deployment/wasm/redis-jwt-auth/
#     have go.mod files; `go mod download` would populate
#     $GOPATH/pkg/mod/cache/.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# `print_usage` writes the help text without exiting so callers control
# the exit code. Previously a single `usage()` did both, which made the
# unknown-option arm (`*) ...; usage >&2; exit 1`) unreachable past the
# inner `exit 0` — so a typo like `--buid-deps` returned 0 and looked
# like a successful run.
print_usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Run \`npm ci\` for every service and shared library in this monorepo
that has a package-lock.json. Developer convenience only — the RTS
FTP-posting workflow does not call this script.

Options:
  --build-deps      Actually run \`npm ci\`. Required: without it the
                    script is a no-op (intentional safety gate; full
                    install can take 5+ minutes on a cold cache).
  --quiet           Suppress per-service progress output.
  --help, -h        Show this message.

Locations:
  REPO_ROOT = ${REPO_ROOT}
EOF
}

build_deps=false
quiet=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-deps) build_deps=true; shift ;;
    --quiet)      quiet=true; shift ;;
    --help|-h)    print_usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; print_usage >&2; exit 1 ;;
  esac
done

log() {
  if ! $quiet; then echo "$@"; fi
}

if ! $build_deps; then
  log "scripts/install-deps.sh: nothing to do (run with --build-deps to npm ci)"
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

log "scripts/install-deps.sh: done (${#lockfiles[@]} service(s) installed)"
