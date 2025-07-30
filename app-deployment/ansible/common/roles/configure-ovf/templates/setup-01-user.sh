#!/bin/bash

set -euo pipefail

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Use USERNAME and PASSWORD from environment, or exit if not set
if [[ -z "${USERNAME:-}" || -z "${PASSWORD:-}" ]]; then
    log "ERROR: USERNAME and PASSWORD environment variables must be set!"
    exit 1
fi

log "Configuring user '${USERNAME}'..."

if id "${USERNAME}" &>/dev/null; then
    log "User '${USERNAME}' already exists, updating password..."
else
    log "Creating user '${USERNAME}'..."
    useradd -m -s /bin/bash "${USERNAME}"
fi

echo "${USERNAME}:${PASSWORD}" | chpasswd
log "User '${USERNAME}' password set."

# Add user to sudo group (uncomment next line if needed)
usermod -aG sudo "${USERNAME}"
log "User '${USERNAME}' added to sudo group."
