#!/bin/bash
# Lalit new script to monitor max CPU usage and write to file

# Check if job ID is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <job_id>"
    exit 1
fi

job_id="$1"

# Get the directory where the script is located
script_dir="$(cd "$(dirname "$0")" && pwd)"

# Set the report file path relative to script location
report_file="${script_dir}/${job_id}_max_cpu_usage.txt"

# Create or clear the report file
> "$report_file"

# Initialize max CPU usage and time
max_cpu_usage=0
max_time=""

# Run the CPU usage monitoring loop
while true; do
    # Linux: get CPU usage from top (100 - idle)
    usage=$(top -bn1 | grep "Cpu(s)" | awk '{print 100 - $8}')
    now=$(date '+%Y-%m-%d %H:%M:%S')

    # Update max_cpu_usage and max_time if new max is found
    usage_int=${usage%.*}
    if [ "$usage_int" -gt "$max_cpu_usage" ]; then
        max_cpu_usage=$usage_int
        max_time="$now"
        echo "${max_time} | ${job_id} | ${max_cpu_usage}%" > "$report_file"
    fi

    sleep 10
done