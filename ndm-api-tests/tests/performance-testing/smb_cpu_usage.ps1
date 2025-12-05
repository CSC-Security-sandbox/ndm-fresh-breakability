param (
    [string]$JobId
)

if (-not $JobId) {
    Write-Host "Usage: .\smb_cpu_usage.ps1 <job_id>"
    exit 1
}

# Report file with absolute path in C:\Temp
$reportFile = "C:\Temp\${JobId}_max_cpu_usage.txt"
$logFile = "C:\Temp\${JobId}_cpu_monitor.log"

# Initialize log
"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] CPU monitoring started for JobId: $JobId" | Out-File $logFile -Encoding utf8

# Initialize report file with format: timestamp | jobid | cpu_usage%
$initTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"${initTime} | ${JobId} | 0" | Out-File $reportFile -Encoding utf8

# Initialize max values
$maxCpu = 0
$maxTime = ""

try {
    $iteration = 0
    while ($true) {
        $iteration++
        $now = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        
        try {
            # Get average CPU usage over short interval (2s to avoid blocking)
            $cpuCounter = Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 2 -MaxSamples 1 -ErrorAction Stop
            $cpuUsage = $cpuCounter.CounterSamples.CookedValue
            $cpuUsage = [math]::Round($cpuUsage, 2)

            "[${now}] Iteration ${iteration}: CPU=${cpuUsage}%" | Out-File $logFile -Append -Encoding utf8

            if ($cpuUsage -gt $maxCpu) {
                $maxCpu = $cpuUsage
                $maxTime = $now

                # Write to file in format: timestamp | jobid | cpu_usage%
                "${now} | ${JobId} | ${maxCpu}" | Out-File $reportFile -Encoding utf8
                "[${now}] New max CPU: ${maxCpu}%" | Out-File $logFile -Append -Encoding utf8
            }
        }
        catch {
            "[${now}] ERROR getting CPU: $($_.Exception.Message)" | Out-File $logFile -Append -Encoding utf8
        }

        Start-Sleep -Seconds 10
    }
}
catch {
    $errorMsg = $_.Exception.Message
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] FATAL ERROR: $errorMsg" | Out-File $logFile -Append -Encoding utf8
}