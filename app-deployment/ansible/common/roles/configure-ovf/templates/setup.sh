#!/bin/bash
set -euo pipefail

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Function to get OVF property
get_ovf_property() {
    /opt/datamigrator/bin/getOvfProperty.sh "$1"
}

# Extract OVF properties once
export IP_ADDRESS=$(get_ovf_property "vplatform.ip0")
export NETMASK=$(get_ovf_property "vplatform.netmask0")
export GATEWAY=$(get_ovf_property "vplatform.gateway0")
export DNS_SERVER_PRIMARY=$(get_ovf_property "vplatform.dns0")
export DNS_SERVER_SECONDARY=$(get_ovf_property "vplatform.dns1")
export SEARCH_DOMAINS=$(get_ovf_property "vplatform.searchDomains")
export USERNAME=$(get_ovf_property "vplatform.ssh_user")
export PASSWORD=$(get_ovf_property "vplatform.ssh_pass")

if [ -f /opt/datamigrator/lock/ovf_customization.done ]; then
    log "Customization already completed. Exiting."
    exit 0
fi

log "Starting User Configuration ..."
. /opt/datamigrator/bin/setup-01-user.sh

log "Starting Network Configuration ..."
. /opt/datamigrator/bin/setup-02-network.sh

log "Customization Completed."
touch /opt/datamigrator/lock/ovf_customization.done

exit 0
