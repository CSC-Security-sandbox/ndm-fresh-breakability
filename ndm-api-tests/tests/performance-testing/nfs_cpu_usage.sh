#!/bin/bash

# Check if job ID is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <job_id>"
    exit 1
fi

# Set the report file name using the job ID
job_id="$1"
report_file="${job_id}_max_cpu_usage.txt"

# Create or clear the report file
> "$report_file"

# Initialize max CPU usage and time
max_cpu_usage=0
max_time=""

# Run the CPU usage monitoring loop
while true; do
    usage=$(sar -u 5 1 | awk '/^Average/ {print 100 - $8}')
    now=$(date)

    # Update max_cpu_usage and max_time if new max is found
    usage_int=${usage%.*}  # Remove decimal for comparison
    if [ "$usage_int" -gt "$max_cpu_usage" ]; then
        max_cpu_usage=$usage_int
        max_time="$now"
        > "$report_file" # clear file
echo "${max_time} | ${job_id} | ${max_cpu_usage}%" >> "$report_file"
    fi

    sleep 10
done
