#!/bin/bash

set -e  # Exit on any error

# Prepare the report file
report_file="test_report.txt"

# Clear or create the report file
: > "$report_file"

# ------------------ USAGE ------------------
# Usage:
# run_tests <test_type> <test_path> <src_volumes> <dest_volumes> [protocol_type] [timeout]
#
# Arguments:
#   test_type      : Mandatory (e.g., regression, smoke, end-to-end)
#   test_path      : Mandatory (path to test directory)
#   src_volumes    : Mandatory (comma-separated list)
#   dest_volumes   : Mandatory (comma-separated list)
#   protocol_type  : Optional (default: "NFS")
#   timeout        : Optional (default: "3h")
# -------------------------------------------

# Function to run tests and log output
run_tests() {
    local test_type="$1"
    local test_path="$2"
    local src_volumes="$3"
    local dest_volumes="$4"
    local protocol_type="${5:-NFS}"
    local timeout="${6:-3h}"

    if [[ -z "$test_type" || -z "$test_path" || -z "$src_volumes" || -z "$dest_volumes" ]]; then
        echo "Error: Missing mandatory arguments."
        echo "Refer to usage above."
        return 1
    fi

    echo -e "\nRunning ${test_type} tests" | tee -a "$report_file"

    echo "ginkgo run -v --timeout="$timeout" "$test_path" -- \
        --protocol_type="$protocol_type" \
        --src_volumes="$src_volumes" \
        --dest_volumes="$dest_volumes" | tee -a "$report_file""

    ginkgo run -v --timeout="$timeout" "$test_path" -- \
        --protocol_type="$protocol_type" \
        --src_volumes="$src_volumes" \
        --dest_volumes="$dest_volumes" | tee -a "$report_file"
}

# Test runs

run_tests "regression" "./tests/regression"

run_tests "end-to-end" "./tests/e2e" "/srv/nfs_share,/srv/nfs_share_utkarsh" "/srv/nfs_share,/srv/nfs_share_utkarsh" "NFS"
#run_tests "end-to-end" "./tests/e2e" "/srv/nfs_share, /srv/nfs_share_utkarsh" "/srv/nfs_share, /srv/nfs_share_utkarsh" "SMB" "3h"

#run_tests "smoke" "./tests/smoke" "vol1,vol2" "vol3,vol4" "3h" "NFS"
