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
    # Capture exit code to allow proper cleanup even on test failure
    set +e  # Temporarily disable exit on error
    ginkgo run -v --timeout="$timeout" "$test_path" -- \
        --protocol_type="$protocol_type" \
        --environment="$environment" | tee -a "$report_file"
    local ginkgo_exit_code=$?
    set -e  # Re-enable exit on error

    local end_time
    end_time=$(date +%s)

    local total_seconds=$((end_time - start_time))
    local minutes=$((total_seconds / 60))
    local seconds=$((total_seconds % 60))
    local formatted_duration="${minutes}m ${seconds}s"

    # Print footer
    if [ $ginkgo_exit_code -eq 0 ]; then
        print_log_banner "Completed Successfully" "$formatted_duration" | tee -a "$report_file"
    else
        print_log_banner "Completed with Failures (Exit Code: $ginkgo_exit_code)" "$formatted_duration" | tee -a "$report_file"
    fi

    # Return the Ginkgo exit code
    return $ginkgo_exit_code
}

# Test runs

#Performance Testing
set +e  # Disable exit on error to capture test exit code
run_tests "perf-testing" "./tests/performance-testing" "Azure" "NFS"
test_exit_code=$?
set -e  # Re-enable exit on error

echo ""
echo "================================================================================"
if [ $test_exit_code -eq 0 ]; then
    echo "✓ Test execution completed successfully"
else
    echo "✗ Test execution completed with failures (Exit Code: $test_exit_code)"
fi
echo "================================================================================"

# Exit with the test's exit code
exit $test_exit_code