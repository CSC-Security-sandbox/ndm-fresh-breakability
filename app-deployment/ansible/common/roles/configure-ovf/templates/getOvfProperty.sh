#!/bin/bash
# getOvfProperty.sh - Extract OVF properties from VMware guestinfo

set -e

# Configuration
OVFENV_CMD="/usr/bin/vmtoolsd --cmd 'info-get guestinfo.ovfEnv'"
SCRIPT_NAME=$(basename "$0")

# Debug function with timestamp
debug() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$SCRIPT_NAME] $1" >&2
}

# Function to check dependencies
check_dependencies() {
    if ! command -v vmtoolsd >/dev/null 2>&1; then
        debug "ERROR: vmtoolsd not found. Please install VMware Tools."
        exit 1
    fi
    if ! command -v xmlstarlet >/dev/null 2>&1; then
        debug "ERROR: xmlstarlet not found. Please install xmlstarlet."
        exit 1
    fi
}

# Function to get OVF property using namespace
get_ovf_property() {
    local property_name="$1"

    # Get OVF environment XML
    local xml_data
    xml_data=$(eval "$OVFENV_CMD" 2>/dev/null)

    if [[ -z "$xml_data" ]]; then
        debug "Failed to retrieve OVF environment from guestinfo.ovfEnv"
        echo -n ""
        exit 0
    fi

    # First check if the property exists (regardless of value)
    local property_exists
    property_exists=$(echo "$xml_data" | \
        xmlstarlet sel -N oe="http://schemas.dmtf.org/ovf/environment/1" \
        -t -v "count(/oe:Environment/oe:PropertySection/oe:Property[@oe:key='$property_name'])" 2>/dev/null || echo "0")

    if [[ "$property_exists" == "0" ]]; then
        debug "ovfProperty not found: $property_name"
        debug "Available properties:"
        echo "$xml_data" | grep -o 'key="[^"]*"' | sed 's/key="\([^"]*\)"/  - \1/' >&2 || true
        echo -n ""
        exit 0
    fi

    # Property exists, get its value (even if empty)
    local property_value
    property_value=$(echo "$xml_data" | \
        xmlstarlet sel -N oe="http://schemas.dmtf.org/ovf/environment/1" \
        -t -v "/oe:Environment/oe:PropertySection/oe:Property[@oe:key='$property_name']/@oe:value" 2>/dev/null || true)

    # If the property exists but value is empty, show a debug message
    if [[ -z "$property_value" ]]; then
        debug "Property '$property_name' exists but has empty value"
    fi

    # Strip enclosing quotes if not a password field
    if [[ ! "$property_name" =~ [Pp]assword ]]; then
        property_value=$(echo "$property_value" | sed 's/^["'\'']\(.*\)["'\'']$/\1/')
    fi

    echo -n "$property_value"
    exit 0
}

# Main function
main() {
    if [[ $# -ne 1 ]]; then
        debug "usage: $SCRIPT_NAME <property_name>"
        debug "example: $SCRIPT_NAME vplatform.ssh_user"
        exit 1
    fi

    check_dependencies
    get_ovf_property "$1"
}

# Run main function
main "$@"