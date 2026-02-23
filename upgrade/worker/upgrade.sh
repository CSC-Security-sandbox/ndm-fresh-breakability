#!/bin/bash
set -euo pipefail

# =============================================================================
# Worker Upgrade Script — Linux
#
# Called by Ansible (or manually). Backs up and merges env while the service
# is still running, then stops the service, swaps the binary, and restarts.
# Auto-rolls back on failure.
#
# Usage: upgrade.sh <version>
# =============================================================================

if [ $# -ne 1 ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 2026.02.10-nightly"
  exit 1
fi

VERSION="$1"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# ── Hardcoded Paths ──────────────────────────────────────────────────────────
BINARY_DIR="/opt/datamigrator/binary"
CONF_DIR="/opt/datamigrator/conf"
ENV_FILE="/opt/datamigrator/conf/worker.env"
VERSIONS_CONF="/opt/datamigrator/conf/versions.conf"
UPGRADED_FLAG="/opt/datamigrator/conf/UPGRADED"
SERVICE_NAME="datamigrator-worker"
STAGING_DIR="/opt/datamigrator/staging/${VERSION}"
BACKUP_DIR="/opt/datamigrator/backup/${VERSION}/${TIMESTAMP}"
BACKUP_LATEST="/opt/datamigrator/backup/latest"
LOG_DIR="/opt/datamigrator/logs"
UPGRADE_LOG="/opt/datamigrator/upgrade.log"

# Instance-specific keys — preserved from the CURRENT env during merge.
# These are injected during initial worker setup and are unique per worker.
INSTANCE_KEYS=(
  WORKER_ID
  CONTROL_PLANE_IP
  CP_BASE_URL
  KEYCLOAK_BASE_URL
  TEMPORAL_ADDRESS
  REDIS_HOST
  WORKER_CONFIG_URL
  WORKER_JOB_SERVICE_URL
  WORKER_REPORT_SERVICE_URL
  TEMPORAL_TLS_ENABLED
  TEMPORAL_TLS_SERVER_NAME
  TEMPORAL_JWT_ENABLED
  WORKER_SECRET
  PROJECT_ID
  OTEL_COLLECTOR_ENDPOINT
  CLIENT_ID
  CLIENT_SECRET
  BASE_WORKING_PATH
  BUILD_ID
)

# ── Helpers ──────────────────────────────────────────────────────────────────

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$UPGRADE_LOG"; }

exit_with_error() {
  log "FATAL: $1"
  exit 1
}

# merge_env <new_template> <current_env> <output>
# Starts with the new template, then overlays instance-specific keys
# from the current env so worker identity and connectivity are preserved.
merge_env() {
  local new_env="$1"
  local cur_env="$2"
  local out="$3"

  cp "$new_env" "$out"

  if [ ! -f "$cur_env" ]; then
    log "No current env to merge — using template as-is"
    return
  fi

  local key value
  while IFS='=' read -r key value; do
    # skip blanks and comments
    [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
    # strip leading whitespace from key
    key=$(echo "$key" | xargs)

    for ikey in "${INSTANCE_KEYS[@]}"; do
      if [ "$key" = "$ikey" ]; then
        if grep -q "^${key}=" "$out" 2>/dev/null; then
          grep -v "^${key}=" "$out" > "$out.tmp" || true
          echo "${key}=${value}" >> "$out.tmp"
          mv "$out.tmp" "$out"
        else
          echo "${key}=${value}" >> "$out"
        fi
        log "  env merge: preserved ${key}"
        break
      fi
    done
  done < "$cur_env"
}

# ── Start ────────────────────────────────────────────────────────────────────

log "=========================================="
log "UPGRADE START — target ${VERSION}"
log "=========================================="

# 1. Verify staging directory exists
[ -d "$STAGING_DIR" ] || exit_with_error "Staging directory not found: $STAGING_DIR"

# ── Phase 1: Backup & Merge (service still running) ─────────────────────────

# 2. Create backup directory
mkdir -p "$BACKUP_DIR"
log "Backup dir: $BACKUP_DIR"

# 3. Backup current binary
BINARY_NAME="dm-worker-linux-x64-v1.0.0"
CURRENT_BINARY="$BINARY_DIR/$BINARY_NAME"
if [ -f "$CURRENT_BINARY" ]; then
  cp "$CURRENT_BINARY" "$BACKUP_DIR/$BINARY_NAME"
  log "Backed up binary: $BINARY_NAME"
else
  log "WARNING: No binary found at $CURRENT_BINARY — skipping backup"
fi

# 4. Backup current env
if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$BACKUP_DIR/worker.env"
  log "Backed up env"
fi

# 5. Backup versions.conf
if [ -f "$VERSIONS_CONF" ]; then
  cp "$VERSIONS_CONF" "$BACKUP_DIR/versions.conf"
  log "Backed up versions.conf"
fi

# 6. Read previous version (before overwrite)
PREVIOUS_VERSION=""
if [ -f "$VERSIONS_CONF" ]; then
  PREVIOUS_VERSION=$(grep -oP 'current_version=\K.*' "$VERSIONS_CONF" 2>/dev/null || true)
fi

# 7. Merge env (new template from staging + instance keys from current env)
STAGED_ENV=$(find "$STAGING_DIR" -maxdepth 1 -type f -name "*.env" ! -name ".env.merged" | head -1 || true)
if [ -n "$STAGED_ENV" ]; then
  merge_env "$STAGED_ENV" "$ENV_FILE" "$STAGING_DIR/.env.merged"
  log "Env merged: $STAGED_ENV + current → .env.merged"
else
  log "WARNING: No .env template in staging — keeping existing env"
fi

# 8. Validate new binary exists before we stop anything
NEW_BINARY=$(find "$STAGING_DIR" -maxdepth 1 -type f \
  -name "datamigrator-worker-linux-${VERSION}" | head -1 || true)
[ -n "$NEW_BINARY" ] || exit_with_error "New binary not found: datamigrator-worker-linux-${VERSION}"

# 9. Write backup pointer
mkdir -p "$(dirname "$BACKUP_LATEST")"
echo "$BACKUP_DIR" > "$BACKUP_LATEST"

# ── Phase 2: Stop Service ────────────────────────────────────────────────────

# 10. Stop the worker service
log "Stopping service ${SERVICE_NAME}…"
systemctl stop "$SERVICE_NAME" 2>/dev/null || true

# 11. Wait for worker process to fully exit
log "Waiting for worker process to exit…"
for i in $(seq 1 30); do
  if ! pgrep -f "dm-worker-linux-x64" > /dev/null 2>&1; then
    log "Worker process stopped"
    break
  fi
  if [ "$i" -eq 30 ]; then
    exit_with_error "Worker process did not stop within 30 s — aborting"
  fi
  log "  still running ($i/30)…"
  sleep 1
done

# 12. Backup and clear logs (service is stopped, no more writes)
if [ -d "$LOG_DIR" ] && [ "$(ls -A "$LOG_DIR" 2>/dev/null)" ]; then
  mkdir -p "$BACKUP_DIR/logs"
  cp -r "$LOG_DIR"/* "$BACKUP_DIR/logs/"
  rm -rf "${LOG_DIR:?}"/*
  log "Backed up and cleared logs"
fi
mkdir -p "$LOG_DIR"

# ── Phase 3: Swap (service is down — minimize this window) ──────────────────

# 13. Swap binary
cp "$NEW_BINARY" "$BINARY_DIR/$BINARY_NAME"
chmod +x "$BINARY_DIR/$BINARY_NAME"
log "Binary swapped: $(basename "$NEW_BINARY") → $BINARY_NAME"

# 14. Apply merged env → conf dir
if [ -f "$STAGING_DIR/.env.merged" ]; then
  cp "$STAGING_DIR/.env.merged" "$ENV_FILE"
  log "Env applied from .env.merged"
elif [ -f "$ENV_FILE" ]; then
  log "Keeping existing env (no merged file produced)"
fi

# 15. Update versions.conf
mkdir -p "$CONF_DIR"
cat > "$VERSIONS_CONF" <<EOF
previous_version=${PREVIOUS_VERSION}
current_version=${VERSION}
upgrade_timestamp=${TIMESTAMP}
EOF
log "versions.conf: ${PREVIOUS_VERSION} → ${VERSION}"

# 16. Write UPGRADED flag (bootstrap reads this as true/false)
echo "true" > "$UPGRADED_FLAG"
log "UPGRADED flag set to true"

# ── Start Service ────────────────────────────────────────────────────────────

log "Starting service…"
systemctl start "$SERVICE_NAME"

log "Waiting 10 s for service to stabilise…"
sleep 10

if systemctl is-active --quiet "$SERVICE_NAME"; then
  log "Service is running — upgrade to ${VERSION} SUCCESSFUL"
  rm -rf "$STAGING_DIR"
  log "Cleaned up staging dir: $STAGING_DIR"
else
  log "ERROR: Service NOT running after upgrade — rolling back"

  # ── Rollback ─────────────────────────────────────────────────────────────
  if [ -f "$BACKUP_DIR/$BINARY_NAME" ]; then
    cp "$BACKUP_DIR/$BINARY_NAME" "$BINARY_DIR/$BINARY_NAME"
    chmod +x "$BINARY_DIR/$BINARY_NAME"
    log "Restored binary from backup"
  fi

  if [ -f "$BACKUP_DIR/worker.env" ]; then
    cp "$BACKUP_DIR/worker.env" "$ENV_FILE"
    log "Restored env from backup"
  fi

  if [ -f "$BACKUP_DIR/versions.conf" ]; then
    cp "$BACKUP_DIR/versions.conf" "$VERSIONS_CONF"
    log "Restored versions.conf from backup"
  fi

  echo "false" > "$UPGRADED_FLAG"

  systemctl start "$SERVICE_NAME" || true
  sleep 5

  if systemctl is-active --quiet "$SERVICE_NAME"; then
    log "Rollback successful — worker running with previous version"
  else
    log "CRITICAL: Rollback ALSO failed — manual intervention required"
  fi
fi

log "=========================================="
log "UPGRADE SCRIPT COMPLETED"
log "=========================================="
