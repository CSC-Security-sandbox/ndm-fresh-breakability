#!/bin/bash

set -e  # Exit on any error

# ------------------ USAGE ------------------
# Usage:
# run_tests <test_type> <test_path> <environment> [protocol_type] [timeout]
#
# Arguments:
#   test_type      : Mandatory (eg., regression, smoke, end-to-end)
#   test_path      : Mandatory (path to test directory)
#   environment    : Mandatory (eg., Azure, vSphere, GCP)
#   protocol_type  : Optional (default: "NFS")
#   timeout        : Optional (default: "3h")
#
# Script Arguments (optional):
#   --smoke         : Run only smoke tests
#   --e2e           : Run only end-to-end tests  
#   --regression    : Run only regression tests
#   (If no flags provided, runs all test types)
# -------------------------------------------

# Parse command line arguments for selective test execution
RUN_SMOKE=false
RUN_E2E=false
RUN_REGRESSION=false
RUN_ALL=true

while [[ $# -gt 0 ]]; do
    case $1 in
        --smoke)
            RUN_SMOKE=true
            RUN_ALL=false
            shift
            ;;
        --e2e)
            RUN_E2E=true
            RUN_ALL=false
            shift
            ;;
        --regression)
            RUN_REGRESSION=true
            RUN_ALL=false
            shift
            ;;
        *)
            # Unknown option, ignore and continue
            shift
            ;;
    esac
done

# If no specific flags provided, run all tests
if [[ "$RUN_ALL" == true ]]; then
    RUN_SMOKE=true
    RUN_E2E=true
    RUN_REGRESSION=true
fi

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
    # Use parallel execution for e2e and smoke tests (3 cores for smoke, 5 for e2e)
    if [[ "$test_type" == "end-to-end" ]]; then
        echo "Running with parallel execution (5 cores)..." | tee -a "$report_file"
        ginkgo run -v -p -procs=5 --timeout="$timeout" "$test_path" -- \
            --protocol_type="$protocol_type" \
            --environment="$environment" | tee -a "$report_file"
    elif [[ "$test_type" == "smoke" ]]; then
        echo "Running with parallel execution (3 cores)..." | tee -a "$report_file"
        ginkgo run -v -p -procs=3 --timeout="$timeout" "$test_path" -- \
            --protocol_type="$protocol_type" \
            --environment="$environment" | tee -a "$report_file"
    else
        ginkgo run -v --timeout="$timeout" "$test_path" -- \
            --protocol_type="$protocol_type" \
            --environment="$environment" | tee -a "$report_file"
    fi

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
if [[ "$RUN_SMOKE" == true ]]; then
    echo "Running SMB Smoke Tests..."
    run_tests "smoke" "./tests/smoke" "Azure" "SMB"
fi

#End-to-End Testing
if [[ "$RUN_E2E" == true ]]; then
    echo "Running SMB End-to-End Tests..."
    run_tests "end-to-end" "./tests/e2e" "Azure" "SMB"
fi

#Regression Testing
if [[ "$RUN_REGRESSION" == true ]]; then
    echo "Running SMB Regression Tests..."
    run_tests "regression" "./tests/regression" "Azure" "SMB"
fi




#Download-Error-Report-Regression Testing
#run_tests "download-error-report-regression" "./tests/download-error-report-regression" "./tests/download-error-report-e2e" "Azure" "SMB"


#Download-Error-Report-End-to-End Testing
#run_tests "download-error-report-e2e" "./tests/download-error-report-e2e" "Azure" "SMB"


#read -p "Test execution complete. Press [Enter] key to exit..."

