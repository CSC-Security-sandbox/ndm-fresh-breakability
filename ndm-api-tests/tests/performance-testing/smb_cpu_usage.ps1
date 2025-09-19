param (
    [string]$JobId
)

if (-not $JobId) {
    Write-Host "Usage: .\smb_cpu_usage.ps1 <job_id>"
    exit 1
}

# Report file
$reportFile = "${JobId}_max_cpu_usage.txt"

# Clear report file if exists
"" | Out-File $reportFile

# Initialize max values
$maxCpu = 0
$maxTime = ""

while ($true) {
    # Get average CPU usage over short interval (5s)
    $cpuUsage = (Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 5 -MaxSamples 1).CounterSamples.CookedValue
    $cpuUsage = [math]::Round($cpuUsage, 2)

    $now = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

    if ($cpuUsage -gt $maxCpu) {
        $maxCpu = $cpuUsage
        $maxTime = $now

        # Write to file (overwrite)
        "$maxTime | $JobId | $maxCpu%" | Out-File $reportFile -Encoding utf8
    }

    Start-Sleep -Seconds 10
}
