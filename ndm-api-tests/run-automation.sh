#!/bin/bash

# Run the regression test
ginkgo run --focus="RTC-001-002" ./tests/regression &> test_regression_output.log

# Run the e2e test
ginkgo run --focus="TC-001" ./tests/e2e  &> test_e2e_output.log

# Prepare the report file
report_file="test_report.txt"

# Clear or create the report file
> "$report_file"


echo -e "\n\033[1;36m#########  Regression test case output:  #######\033[0m" | tee -a "$report_file"
tail -n 7 test_regression_output.log | tee -a "$report_file"


echo -e "\n\n \033[1;36m#########  E2E Test case output:  #######\033[0m" | tee -a "$report_file"
tail -n 7 test_e2e_output.log | tee -a "$report_file"
