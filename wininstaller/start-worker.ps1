$logPath = "logs\datamigrator-worker.log"
$envFile = "conf\worker.env"

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^\s*$" -or $_ -match "^\s*#") { return }

        $parts = $_ -split '=', 2
        if ($parts.Count -eq 2) {
            $key = $parts[0].Trim()
            $value = $parts[1]

            [Environment]::SetEnvironmentVariable($key, $value, [System.EnvironmentVariableTarget]::Process)
            Write-Host "Set env: $key=[value set]"
        }
    }
    Write-Host "Environment variables loaded from $envFile"
} else {
    Write-Host "No env file found at $envFile"
}

Write-Host "Starting worker.exe and directing logs to $logPath"

& "binary\worker.exe" $args *>> $logPath
 