#!/bin/bash

set -e  # Exit on any error

# Prepare the report file
report_file="test_report.txt"

# Clear or create the report file
: > "$report_file"

# Function to run tests and log output
run_tests() {
    local test_type="$1"
    local test_path="$2"
    local timeout="${3:-3h}"  # Defaults to 3 hours if not passed
 
    echo -e "Running ${test_type} tests" | tee -a "$report_file"
    ginkgo run -v --timeout="$timeout" "$test_path" | tee -a "$report_file"
}

# Run regression tests
run_tests "regression" "./tests/regression"

# Run end-to-end tests
# run_tests "end-to-end" "./tests/e2e"

# Run smoke tests
# run_tests "smoke" "./tests/smoke"
