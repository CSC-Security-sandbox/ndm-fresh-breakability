#!/bin/bash

set -e  # Exit on any error

# ------------------ USAGE ------------------
# Usage:
# run_tests <test_type> <test_path> <src_volumes> <dest_volumes> [protocol_type] [timeout]
#
# Arguments:
#   test_type      : Mandatory (e.g., regression, smoke, end-to-end)
#   test_path      : Mandatory (path to test directory)
#   src_volumes    : Mandatory (comma-separated list)
#   dest_volumes   : Mandatory (comma-separated list)
#   protocol_type  : Optional (default: "NFS")
#   timeout        : Optional (default: "3h")
# -------------------------------------------

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
    local src_volumes="${3:-}"
    local dest_volumes="${4:-}"
    local protocol_type="${5:-}"
    local timeout="${6:-3h}"

    if [[ "$test_type" != "smoke" && ( -z "$test_type" || -z "$test_path" || -z "$src_volumes" || -z "$dest_volumes" ) ]]; then
        echo "Error: Missing mandatory arguments."
        echo "Refer to usage above."
        return 1
    fi

    # Format date and time
    local date_folder
    date_folder=$(date "+%Y-%m-%d")

    local epoch_time
    epoch_time=$(date +%s)

    local run_id
    run_id="${test_type}_${epoch_time}"


    local protocol_dir
    protocol_dir=$(echo "$protocol_type" | tr '[:lower:]' '[:upper:]')


    # Create folders
    # log file location - reports/date/protocol_type/test-type-protocol-type-epoch-time.log 
    # eg reports/2025-07-22/NFS/end-to-end-NFS-1753166831.log
    if [ -z "$protocol_type" ]; then
        output_dir="reports/${date_folder}"
    else
        output_dir="reports/${date_folder}/${protocol_dir}"
    fi

    mkdir -p "$output_dir"

    # Final log file path
    local report_file="${output_dir}/${run_id}.log"

    # Function to print log in format
    print_log_banner() {
    local label="$1"
    local duration="$2"
    echo -e "\n================================================================================"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ${label} ${test_type} tests"

    if [[ "$test_type" != "smoke" ]]; then
        echo "Protocol type         : ${protocol_type}"
        echo "Source Volumes        : ${src_volumes}"
        echo "Dest Volumes          : ${dest_volumes}"
    fi

    echo "Test Path             : ${test_path}"
    echo "Timeout               : ${timeout}"
    echo "Log File Location     : ${report_file}"
    [[ -n "$duration" ]] && echo "Total Duration        : ${duration}"
    echo "================================================================================"
}


    local start_time
    start_time=$(date +%s)

    # Print header
    print_log_banner "Starting" | tee -a "$report_file"

    # Run Ginkgo test and log output
    ginkgo run -v --timeout="$timeout" "$test_path" -- \
        --protocol_type="$protocol_type" \
        --src_volumes="$src_volumes" \
        --dest_volumes="$dest_volumes" | tee -a "$report_file"

    local end_time
    end_time=$(date +%s)

    local total_seconds=$((end_time - start_time))
    local minutes=$((total_seconds / 60))
    local seconds=$((total_seconds % 60))
    local formatted_duration="${minutes}m ${seconds}s"

    # Print footer
    print_log_banner "Completed" "$formatted_duration" | tee -a "$report_file"
}

# Test runs

#Regression Testing
run_tests "regression" "./tests/regression" "vol_src_automation, volSrcAuto, vol_src_automation2"  "vol_dest_automation, vol_dest_automation2"  "NFS"
run_tests "regression" "./tests/regression" "volSMBAuto_vol1, vol4_33, vol2_33"  "volSMBAutoDst, vol3_33" "SMB"


#End-to-End Testing
run_tests "end-to-end" "./tests/e2e" "vol_src_automation, volSrcAuto, vol_src_automation2"  "vol_dest_automation, vol_dest_automation2" "NFS"
#run_tests "end-to-end" "./tests/e2e" "volSMBAuto_vol1, vol4_33, vol2_33"  "volSMBAutoDst, vol3_33" "SMB"


#Smoke Testing
run_tests "smoke" "./tests/smoke"



#read -p "Test execution complete. Press [Enter] key to exit..."
