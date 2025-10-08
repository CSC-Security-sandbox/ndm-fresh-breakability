#!/bin/bash

set -e  # Exit on any error

# ------------------ USAGE ------------------
# Usage:
# run_tests <test_type> <test_path> <environment> [protocol_type] [timeout]
#
# Arguments:
#   test_type      : Mandatory (eg., regression, smoke, end-to-end)
#   test_path      : Mandatory (path to test directory)
#   environment    : Mandatory (eg., Azure, vSphere, GCP)
#   protocol_type  : Optional (default: "NFS")
#   timeout        : Optional (default: "3h")
# -------------------------------------------

# Function to run tests and log output
run_tests() {
    local test_type="$1"
    local test_path="$2"
    local environment="$3"
    local protocol_type="${4:-NFS}"
    local timeout="${5:-4h}"

     if [[ -z "$test_type" || -z "$test_path" || -z "$environment" ]]; then
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
    local output_dir="reports/${date_folder}/${protocol_dir}"
    mkdir -p "$output_dir"

    # Final log file path
    local report_file="${output_dir}/${run_id}.log"

    # Function to print log in format
    print_log_banner() {
        local label="$1"
        local duration="$2"
        echo -e "\n================================================================================"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ${label} ${test_type} tests"
        echo "Protocol type         : ${protocol_type}"
        echo "Test Path             : ${test_path}"
        echo "Environment           : ${environment}"
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
        --environment="$environment" | tee -a "$report_file"

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

#Smoke Testing
# run_tests "smoke" "./tests/smoke" "Azure" "NFS"

#End-to-End Testing
# run_tests "end-to-end" "./tests/e2e" "Azure" "NFS"

#Regression Testing
run_tests "regression" "./tests/regression" "Azure" "NFS"
run_tests "regression" "./tests/regression" "Azure" "NFS"
run_tests "regression" "./tests/regression" "Azure" "NFS"
run_tests "regression" "./tests/regression" "Azure" "NFS"
run_tests "regression" "./tests/regression" "Azure" "NFS"
run_tests "regression" "./tests/regression" "Azure" "NFS"
run_tests "regression" "./tests/regression" "Azure" "NFS"
run_tests "regression" "./tests/regression" "Azure" "NFS"
run_tests "regression" "./tests/regression" "Azure" "NFS"
run_tests "regression" "./tests/regression" "Azure" "NFS"

#Download-Error-Report-Regression Testing
#run_tests "download-error-report-regression" "./tests/download-error-report-regression" "./tests/download-error-report-e2e" "Azure" "NFS"


#Download-Error-Report-End-to-End Testing
#run_tests "download-error-report-e2e" "./tests/download-error-report-e2e" "Azure" "NFS"


#read -p "Test execution complete. Press [Enter] key to exit..."
