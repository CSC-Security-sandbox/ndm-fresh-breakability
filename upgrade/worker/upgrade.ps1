# =============================================================================
# Worker Upgrade Script — Windows
#
# Backs up and merges env while the service is still running, then stops
# the service, swaps the binary, and restarts. Auto-rolls back on failure.
#
# Usage: powershell -ExecutionPolicy Bypass -File upgrade.ps1 -Version <ver>
# =============================================================================

param(
  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = "Stop"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

# -- Hardcoded Paths ----------------------------------------------------------
$BinaryDir    = "C:\datamigrator\binary"
$BinaryName   = "worker.exe"
$EnvFile      = "C:\datamigrator\binary\.env"
$ConfDir      = "C:\datamigrator\conf"
$VersionsConf = "C:\datamigrator\conf\versions.conf"
$UpgradedFlag = "C:\datamigrator\conf\UPGRADED"
$ServiceName  = "DatamigratorWorker"
$StagingDir   = "C:\datamigrator\staging\$Version"
$BackupDir    = "C:\datamigrator\backup\$Version\$Timestamp"
$BackupLatest = "C:\datamigrator\backup\latest"
$UpgradeLog   = "C:\datamigrator\upgrade.log"

$LogDirs = @(
  "C:\datamigrator\logs",
  "C:\datamigrator\binary\logs"
)

# Instance-specific keys preserved from the CURRENT .env during merge.
$InstanceKeys = @(
  "WORKER_ID"
  "CONTROL_PLANE_IP"
  "CP_BASE_URL"
  "KEYCLOAK_BASE_URL"
  "TEMPORAL_ADDRESS"
  "TEMPORAL_TLS_ENABLED"
  "TEMPORAL_TLS_SERVER_NAME"
  "TEMPORAL_JWT_ENABLED"
  "TLS_CERT"
  "REDIS_HOST"
  "REDIS_JWT_AUTH_ENABLED"
  "REDIS_GATEWAY_HOST"
  "REDIS_GATEWAY_PORT"
  "WORKER_CONFIG_URL"
  "WORKER_JOB_SERVICE_URL"
  "WORKER_REPORT_SERVICE_URL"
  "WORKER_SECRET"
  "PROJECT_ID"
  "OTEL_COLLECTOR_ENDPOINT"
  "CLIENT_ID"
  "CLIENT_SECRET"
  "BASE_WORKING_PATH"
  "BUILD_ID"
)

# -- Helpers -------------------------------------------------------------------

function Write-Log {
  param([string]$Message)
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
  Add-Content -Path $UpgradeLog -Value $line
}

function Exit-Fatal {
  param([string]$Message)
  Write-Log "FATAL: $Message"
  exit 1
}

function Merge-Env {
  param(
    [string]$NewEnvPath,
    [string]$CurrentEnvPath,
    [string]$OutputPath
  )

  Copy-Item $NewEnvPath -Destination $OutputPath -Force

  if (-not (Test-Path $CurrentEnvPath)) {
    Write-Log "No current env to merge - using template as-is"
    return
  }

  $mergedLines = Get-Content $OutputPath
  $currentLines = Get-Content $CurrentEnvPath

  foreach ($line in $currentLines) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith("#")) { continue }

    $eqIdx = $line.IndexOf("=")
    if ($eqIdx -lt 1) { continue }

    $key = $line.Substring(0, $eqIdx).Trim()
    $value = $line.Substring($eqIdx + 1)

    if ($InstanceKeys -contains $key) {
      $found = $false
      $mergedLines = $mergedLines | ForEach-Object {
        if ($_ -match "^$key=") {
          $found = $true
          "${key}=${value}"
        } else {
          $_
        }
      }
      if (-not $found) {
        $mergedLines += "${key}=${value}"
      }
      Write-Log "  env merge: preserved $key"
    }
  }

  $mergedLines | Set-Content -Path $OutputPath
}

# -- Start ---------------------------------------------------------------------

Write-Log "=========================================="
Write-Log "UPGRADE START - target $Version"
Write-Log "=========================================="

# 1. Verify staging directory
if (-not (Test-Path $StagingDir)) {
  Exit-Fatal "Staging directory not found: $StagingDir"
}

# == Phase 1: Backup & Merge (service still running) ==========================

# 2. Create backup directory
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
Write-Log "Backup dir: $BackupDir"

# 3. Backup current binary
$currentBinaryPath = "$BinaryDir\$BinaryName"
if (Test-Path $currentBinaryPath) {
  Copy-Item $currentBinaryPath -Destination "$BackupDir\$BinaryName" -Force
  Write-Log "Backed up binary: $BinaryName"
} else {
  Write-Log "WARNING: No binary found at $currentBinaryPath - skipping backup"
}

# 4. Backup current .env
if (Test-Path $EnvFile) {
  Copy-Item $EnvFile -Destination "$BackupDir\.env" -Force
  Write-Log "Backed up env"
}

# 5. Backup versions.conf
if (Test-Path $VersionsConf) {
  Copy-Item $VersionsConf -Destination "$BackupDir\versions.conf" -Force
  Write-Log "Backed up versions.conf"
}

# 6. Read previous version (before overwrite)
$previousVersion = ""
if (Test-Path $VersionsConf) {
  $match = (Get-Content $VersionsConf -ErrorAction SilentlyContinue) |
    Select-String -Pattern "current_version=(.*)" -ErrorAction SilentlyContinue
  if ($match) { $previousVersion = $match.Matches[0].Groups[1].Value }
}

# 7. Merge env
$stagedEnv = Get-ChildItem -Path $StagingDir -Filter "*.env" -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -ne ".env.merged" } | Select-Object -First 1
if ($stagedEnv) {
  Merge-Env -NewEnvPath $stagedEnv.FullName -CurrentEnvPath $EnvFile `
    -OutputPath "$StagingDir\.env.merged"
  Write-Log "Env merged: $($stagedEnv.Name) + current -> .env.merged"
} else {
  Write-Log "WARNING: No .env template in staging - keeping existing env"
}

# 8. Validate new binary exists before we stop anything
$newBinary = Get-ChildItem -Path $StagingDir `
  -Filter "datamigrator-worker-windows-$Version.exe" -File -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $newBinary) {
  Exit-Fatal "New binary not found: datamigrator-worker-windows-$Version.exe"
}

# 9. Write backup pointer
$backupParent = Split-Path $BackupLatest -Parent
if (-not (Test-Path $backupParent)) {
  New-Item -ItemType Directory -Path $backupParent -Force | Out-Null
}
Set-Content -Path $BackupLatest -Value $BackupDir

# == Phase 2: Stop Service =====================================================

# 10. Stop the worker service
Write-Log "Stopping service $ServiceName..."
try { Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue } catch { }

# 11. Wait for worker process to fully exit
Write-Log "Waiting for worker process to exit..."
for ($i = 1; $i -le 30; $i++) {
  $proc = Get-Process -Name "worker" -ErrorAction SilentlyContinue
  if (-not $proc) {
    Write-Log "Worker process stopped"
    break
  }
  if ($i -eq 30) {
    Exit-Fatal "Worker process did not stop within 30 s - aborting"
  }
  Write-Log "  still running ($i/30)..."
  Start-Sleep -Seconds 1
}

# 12. Backup and clear logs (service is stopped, no more writes)
foreach ($logDir in $LogDirs) {
  if ((Test-Path $logDir) -and (Get-ChildItem $logDir -ErrorAction SilentlyContinue)) {
    $safeName = ($logDir -replace '^C:\\', '') -replace '\\', '-'
    $backupLogDir = "$BackupDir\logs\$safeName"
    New-Item -ItemType Directory -Path $backupLogDir -Force | Out-Null
    Copy-Item "$logDir\*" -Destination $backupLogDir -Recurse -Force
    Remove-Item "$logDir\*" -Recurse -Force
    Write-Log "Backed up and cleared logs: $logDir"
  }
  if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  }
}

# == Phase 3: Swap (service is down — minimize this window) ====================

# 13. Swap binary
Copy-Item $newBinary.FullName -Destination "$BinaryDir\$BinaryName" -Force
Write-Log "Binary swapped: $($newBinary.Name) -> $BinaryName"

# 14. Apply merged env
if (Test-Path "$StagingDir\.env.merged") {
  Copy-Item "$StagingDir\.env.merged" -Destination $EnvFile -Force
  Write-Log "Env applied from .env.merged"
} elseif (Test-Path $EnvFile) {
  Write-Log "Keeping existing env (no merged file produced)"
}

# 15. Update versions.conf
if (-not (Test-Path $ConfDir)) {
  New-Item -ItemType Directory -Path $ConfDir -Force | Out-Null
}
@"
previous_version=$previousVersion
current_version=$Version
upgrade_timestamp=$Timestamp
"@ | Set-Content -Path $VersionsConf
Write-Log "versions.conf: $previousVersion -> $Version"

# 16. Write UPGRADED flag (bootstrap reads this as true/false)
Set-Content -Path $UpgradedFlag -Value "true"
Write-Log "UPGRADED flag set to true"

# == Apply SMB and TCP Performance Tuning ======================================

Write-Log "Applying SMB and TCP performance tuning..."

try {
  Set-SmbClientConfiguration -MaxCmds 128 -ConnectionCountPerRssNetworkInterface 4 `
    -DirectoryCacheLifetime 30 -FileInfoCacheLifetime 30 -FileNotFoundCacheLifetime 30 `
    -EnableMultiChannel $true -EnableBandwidthThrottling $false -EnableLargeMtu $true -Force
  Write-Log "SMB client configuration applied"
} catch {
  Write-Log "WARNING: SMB client configuration failed: $($_.Exception.Message)"
}

try {
  Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters' -Name TcpWindowSize -Value 4194304 -Type DWord
  Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters' -Name GlobalMaxTcpWindowSize -Value 4194304 -Type DWord
  Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters' -Name Tcp1323Opts -Value 3 -Type DWord
  Write-Log "TCP window tuning applied"
} catch {
  Write-Log "WARNING: TCP window tuning failed: $($_.Exception.Message)"
}

try {
  Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters' -Name MaxCmds -Value 128 -Type DWord
  Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters' -Name MaxCollectionCount -Value 32 -Type DWord
  Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters' -Name RequireSecuritySignature -Value 0 -Type DWord
  Write-Log "LanmanWorkstation tuning applied"
} catch {
  Write-Log "WARNING: LanmanWorkstation tuning failed: $($_.Exception.Message)"
}

Write-Log "SMB and TCP performance tuning completed"

# == Start Service =============================================================

Write-Log "Starting service..."
Start-Service -Name $ServiceName

Write-Log "Waiting 10 s for service to stabilise..."
Start-Sleep -Seconds 10

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
  Write-Log "Service is running - upgrade to $Version SUCCESSFUL"
  Remove-Item $StagingDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Log "Cleaned up staging dir: $StagingDir"
} else {
  Write-Log "ERROR: Service NOT running after upgrade - rolling back"

  # -- Rollback ----------------------------------------------------------------
  if (Test-Path "$BackupDir\$BinaryName") {
    Copy-Item "$BackupDir\$BinaryName" -Destination "$BinaryDir\$BinaryName" -Force
    Write-Log "Restored binary from backup"
  }

  if (Test-Path "$BackupDir\.env") {
    Copy-Item "$BackupDir\.env" -Destination $EnvFile -Force
    Write-Log "Restored env from backup"
  }

  if (Test-Path "$BackupDir\versions.conf") {
    Copy-Item "$BackupDir\versions.conf" -Destination $VersionsConf -Force
    Write-Log "Restored versions.conf from backup"
  }

  Set-Content -Path $UpgradedFlag -Value "false"

  try { Start-Service -Name $ServiceName } catch { }
  Start-Sleep -Seconds 5

  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -eq "Running") {
    Write-Log "Rollback successful - worker running with previous version"
  } else {
    Write-Log "CRITICAL: Rollback ALSO failed - manual intervention required"
  }
}

Write-Log "=========================================="
Write-Log "UPGRADE SCRIPT COMPLETED"
Write-Log "=========================================="
