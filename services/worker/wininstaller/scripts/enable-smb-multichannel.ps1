<#
.SYNOPSIS
    Enables SMB Multichannel on a Datamigrator Windows worker.

.DESCRIPTION
    Idempotent. Safe to re-run. Configures the SMB client for multichannel,
    raises connection caps, and enables RSS on physical NICs so the kernel
    SMB redirector can open multiple channels per server.

    Settings applied (client-side only):
      - SMB Multichannel:                          enabled
      - ConnectionCountPerRssNetworkInterface:     4
      - ConnectionCountPerRdmaNetworkInterface:    2
      - MaximumConnectionCountPerServer:           64
      - RSS on every physical "Up" NIC:            enabled

    The script writes a log to C:\datamigrator\logs\enable-smb-multichannel.log
    and a JSON snapshot of the prior state next to it for rollback reference.

.PARAMETER MaxConnectionsPerServer
    Override default cap (64). Bump if you have very high MAX_WRITE_CONCURRENCY.

.PARAMETER ConnectionsPerRssNic
    Override default (4). Don't exceed NIC RSS queue count.

.PARAMETER WhatIf
    Show what would change without applying.

.EXAMPLE
    PS> .\enable-smb-multichannel.ps1
    PS> .\enable-smb-multichannel.ps1 -MaxConnectionsPerServer 128
    PS> .\enable-smb-multichannel.ps1 -WhatIf
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [int]$MaxConnectionsPerServer = 64,
    [int]$ConnectionsPerRssNic    = 4,
    [int]$ConnectionsPerRdmaNic   = 2,
    [string]$LogDir               = 'C:\datamigrator\logs'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogFile      = Join-Path $LogDir 'enable-smb-multichannel.log'
$SnapshotFile = Join-Path $LogDir ('smb-multichannel-pre-state-{0}.json' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p  = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    Write-Log 'Must run as Administrator.' 'ERROR'
    exit 2
}

Write-Log '=== SMB Multichannel enablement starting ==='
Write-Log ('Host: {0}  OS: {1}' -f $env:COMPUTERNAME, (Get-CimInstance Win32_OperatingSystem).Caption)

# ---------- Snapshot prior state for rollback ----------
try {
    $clientCfg = Get-SmbClientConfiguration | Select-Object EnableMultiChannel,
                                                            MaximumConnectionCountPerServer,
                                                            ConnectionCountPerRssNetworkInterface,
                                                            ConnectionCountPerRdmaNetworkInterface
    $rssState  = Get-NetAdapterRss -ErrorAction SilentlyContinue |
                 Select-Object Name, Enabled, NumberOfReceiveQueues
    @{
        Timestamp        = (Get-Date).ToString('o')
        SmbClient        = $clientCfg
        NetAdapterRss    = $rssState
    } | ConvertTo-Json -Depth 6 | Set-Content -Path $SnapshotFile -Encoding UTF8
    Write-Log ('Pre-state snapshot saved: {0}' -f $SnapshotFile)
} catch {
    Write-Log ('Failed to snapshot prior state: {0}' -f $_.Exception.Message) 'WARN'
}

# ---------- 1. SMB client multichannel + connection caps ----------
try {
    $cfg = Get-SmbClientConfiguration

    if (-not $cfg.EnableMultiChannel) {
        if ($PSCmdlet.ShouldProcess('SmbClient', 'Enable Multichannel')) {
            Set-SmbClientConfiguration -EnableMultiChannel $true -Confirm:$false
            Write-Log 'SMB client multichannel: ENABLED'
        }
    } else {
        Write-Log 'SMB client multichannel: already enabled (no change)'
    }

    if ($cfg.MaximumConnectionCountPerServer -ne $MaxConnectionsPerServer) {
        if ($PSCmdlet.ShouldProcess('SmbClient', "MaximumConnectionCountPerServer=$MaxConnectionsPerServer")) {
            Set-SmbClientConfiguration -MaximumConnectionCountPerServer $MaxConnectionsPerServer -Confirm:$false
            Write-Log ('MaximumConnectionCountPerServer: {0} -> {1}' -f $cfg.MaximumConnectionCountPerServer, $MaxConnectionsPerServer)
        }
    }

    if ($cfg.ConnectionCountPerRssNetworkInterface -ne $ConnectionsPerRssNic) {
        if ($PSCmdlet.ShouldProcess('SmbClient', "ConnectionCountPerRssNetworkInterface=$ConnectionsPerRssNic")) {
            Set-SmbClientConfiguration -ConnectionCountPerRssNetworkInterface $ConnectionsPerRssNic -Confirm:$false
            Write-Log ('ConnectionCountPerRssNetworkInterface: {0} -> {1}' -f $cfg.ConnectionCountPerRssNetworkInterface, $ConnectionsPerRssNic)
        }
    }

    if ($cfg.ConnectionCountPerRdmaNetworkInterface -ne $ConnectionsPerRdmaNic) {
        if ($PSCmdlet.ShouldProcess('SmbClient', "ConnectionCountPerRdmaNetworkInterface=$ConnectionsPerRdmaNic")) {
            Set-SmbClientConfiguration -ConnectionCountPerRdmaNetworkInterface $ConnectionsPerRdmaNic -Confirm:$false
            Write-Log ('ConnectionCountPerRdmaNetworkInterface: {0} -> {1}' -f $cfg.ConnectionCountPerRdmaNetworkInterface, $ConnectionsPerRdmaNic)
        }
    }
} catch {
    Write-Log ('SMB client config failed: {0}' -f $_.Exception.Message) 'ERROR'
    exit 3
}

# ---------- 2. Enable RSS on every physical Up adapter ----------
$adapters = Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
            Where-Object { $_.Status -eq 'Up' }

if (-not $adapters) {
    Write-Log 'No physical Up NICs found — multichannel will only matter once one is online.' 'WARN'
} else {
    foreach ($a in $adapters) {
        try {
            $rss = Get-NetAdapterRss -Name $a.Name -ErrorAction Stop
            if (-not $rss.Enabled) {
                if ($PSCmdlet.ShouldProcess($a.Name, 'Enable-NetAdapterRss')) {
                    Enable-NetAdapterRss -Name $a.Name
                    Write-Log ('NIC {0}: RSS enabled' -f $a.Name)
                }
            } else {
                Write-Log ('NIC {0}: RSS already enabled (queues={1})' -f $a.Name, $rss.NumberOfReceiveQueues)
            }
        } catch {
            Write-Log ('NIC {0}: RSS not supported or failed ({1})' -f $a.Name, $_.Exception.Message) 'WARN'
        }
    }
}

# ---------- 3. Verify ----------
Write-Log '--- Post-change state ---'
$post = Get-SmbClientConfiguration | Select-Object EnableMultiChannel,
                                                   MaximumConnectionCountPerServer,
                                                   ConnectionCountPerRssNetworkInterface,
                                                   ConnectionCountPerRdmaNetworkInterface
$post | Format-List | Out-String | ForEach-Object { Write-Log $_.Trim() }

$nics = Get-SmbClientNetworkInterface -ErrorAction SilentlyContinue
if ($nics) {
    Write-Log 'Client SMB network interfaces:'
    $nics | Format-Table -AutoSize | Out-String | ForEach-Object { Write-Log $_.Trim() }
}

$active = Get-SmbMultichannelConnection -ErrorAction SilentlyContinue
if ($active) {
    Write-Log 'Active multichannel connections (live):'
    $active | Format-Table -AutoSize | Out-String | ForEach-Object { Write-Log $_.Trim() }
} else {
    Write-Log 'No active multichannel connections yet — they appear on next SMB session to a multichannel-capable server.'
}

Write-Log '=== SMB Multichannel enablement complete ==='
exit 0
