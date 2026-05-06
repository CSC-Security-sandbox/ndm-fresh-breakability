<#
.SYNOPSIS
    SMB continuous source-churn script.

.DESCRIPTION
    Runs indefinitely (or for -DurationSeconds) against a local SMB mount /
    UNC path, performing the operations below in random order and logging every
    action to a JSON-lines log file so the migration test can verify that all
    changes were captured by an incremental migration pass.

    The share is walked ONCE at startup.  The in-memory dir list never changes
    (no directory create/delete).  The file list is updated incrementally as
    files are created or deleted.

    MODE 1 - RANDOM (default):
      Operations performed:
        1. TOUCH_MTIME        - update LastWriteTime on a random file or folder
        2. CHANGE_DIR_PERM    - toggle the single Principal ACE on a random directory
        3. CHANGE_FILE_PERM   - toggle the single Principal ACE on a random file
        4. CREATE_FILE        - create a new file with random content
        5. DELETE_FILE        - delete a random file (keeps at least 5 files)

    MODE 2 - FOCUSED (-TargetFiles "file1,file2"):
      Spawns one background thread per target file.  Each thread hammers its
      file with mtime changes as fast as possible - no sleep, no delay.
      Use this to stress-test retry logic / conflict detection.

.PARAMETER Path
    Absolute path to the SMB share root (UNC or mapped drive), e.g.
    "\\server\share" or "Z:\".

.PARAMETER LogFile
    Path to the output JSON-lines log file, e.g. "C:\churn_logs\smb_churn.log".

.PARAMETER DurationSeconds
    Stop after this many seconds.  0 (default) = run forever.

.PARAMETER IntervalSeconds
    Sleep between operations in seconds.  Default: 2.

.PARAMETER Principal
    A single AD/local principal to toggle on ACEs.
    If the ACE is present it is removed; if absent it is added.
    Default: "Everyone".

.EXAMPLE
    # Run forever with default principal (Everyone)
    .\smb_churn.ps1 -Path "\\nas\src_share" -LogFile "C:\logs\smb_churn.log"

.EXAMPLE
    # Run for 10 minutes, 1-second interval, specific AD principal
    .\smb_churn.ps1 -Path "Z:\" -LogFile "C:\logs\smb.log" `
        -DurationSeconds 600 -IntervalSeconds 1 `
        -Principal "DOMAIN\TestUser1"

.NOTES
    * Must be run as Administrator (or with SeSecurityPrivilege) to modify ACLs.
    * Log format: one JSON object per line -
        {"ts":"<ISO-8601>","op":"<OP>","path":"<relative>","detail":{...}}
    * The log is the ground-truth record used by the migration verification test.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $Path,

    [Parameter(Mandatory)]
    [string] $LogFile,

    [int]    $DurationSeconds  = 0,
    [double] $IntervalSeconds  = 2.0,
    [string] $Principal        = "Everyone",

    # How many operations to run per tick (a random value in [BatchMin, BatchMax])
    [int]    $BatchMin         = 1,
    [int]    $BatchMax         = 20,

    # FOCUSED MODE: comma-separated absolute paths to the files to hammer.
    # When set, random-mode is skipped entirely and one thread per file
    # runs with no sleep at all.
    # Example: -TargetFiles "\\nas\share\a.txt,\\nas\share\b.txt"
    [string] $TargetFiles      = "",

    # Optional credentials to mount the UNC share.
    # Omit both to use the current Windows session credentials.
    # Provide -ShareUser only to get a secure password prompt.
    # Provide both to pass password inline (e.g. in CI).
    [string] $ShareUser        = "",
    [string] $SharePassword    = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"   # log errors but keep looping

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
function Write-JsonLog {
    param(
        [string] $Op,
        [string] $RelPath,
        [hashtable] $Detail = @{}
    )
    $entry = [ordered]@{
        ts     = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        op     = $Op
        path   = $RelPath
        detail = $Detail
    }
    $line = $entry | ConvertTo-Json -Compress -Depth 5
    Add-Content -LiteralPath $LogFile -Value $line
    Write-Host ("{0,-18}  {1,-40}  {2}" -f $Op, $RelPath, ($Detail | ConvertTo-Json -Compress))
}

function Write-ErrorLog {
    param([string]$Op, [string]$RelPath, [string]$Err)
    $entry = [ordered]@{
        ts    = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        op    = $Op
        path  = $RelPath
        error = $Err
    }
    Add-Content -LiteralPath $LogFile -Value ($entry | ConvertTo-Json -Compress)
    Write-Warning "ERROR  $Op  $RelPath  $Err"
}

function Get-RelativePath([string]$AbsPath) {
    if ($AbsPath.StartsWith($Root)) {
        return $AbsPath.Substring($Root.Length).TrimStart('\','/')
    }
    return $AbsPath
}

# ---------------------------------------------------------------------------
# One-time scan at startup - populates script-scoped $AllDirs and $AllFiles
# ---------------------------------------------------------------------------
function Initialize-State {
    Write-Host "Scanning $Root ..."

    # Directories: static (no create/delete during the run)
    $script:AllDirs = @(
        Get-ChildItem -LiteralPath $Root -Recurse -Directory -Force -ErrorAction SilentlyContinue |
            ForEach-Object { $_.FullName }
    )

    # Files: live list - build robustly so the cast works for 0/1/many items
    $script:AllFiles = New-Object 'System.Collections.Generic.List[string]'
    Get-ChildItem -LiteralPath $Root -Recurse -File -Force -ErrorAction SilentlyContinue |
        ForEach-Object { [void]$script:AllFiles.Add($_.FullName) }

    Write-Host ("Scan complete: {0} dirs, {1} files" -f $script:AllDirs.Count, $script:AllFiles.Count)
}

function Pick-Random([array]$arr) {
    if ($arr.Count -eq 0) { return $null }
    return $arr[(Get-Random -Maximum $arr.Count)]
}

function Pick-RandomFromList([System.Collections.Generic.List[string]]$list) {
    if ($list.Count -eq 0) { return $null }
    return $list[(Get-Random -Maximum $list.Count)]
}

# ---------------------------------------------------------------------------
# Shared: tiered mtime offset always under 60 s
# ---------------------------------------------------------------------------
function Get-RandomOffsetSecs {
    # 50% chance 1-30 s, 50% chance 30-60 s; random sign
    $magnitude = if ((Get-Random -Maximum 2) -eq 0) {
        Get-Random -Minimum 1 -Maximum 30
    } else {
        Get-Random -Minimum 30 -Maximum 60
    }
    $sign = if ((Get-Random -Maximum 2) -eq 0) { 1 } else { -1 }
    return $magnitude * $sign
}

# ---------------------------------------------------------------------------
# Operations  -  all use $script:AllDirs / $script:AllFiles, no re-scan
# ---------------------------------------------------------------------------
function Op-TouchMtime {
    # Combine static dir list + live file list
    $targets = @($script:AllDirs) + @($script:AllFiles)
    if ($targets.Count -eq 0) { return }
    $targetPath = Pick-Random $targets
    $offsetSec  = Get-RandomOffsetSecs
    # Use UTC now so the value assigned to LastWriteTimeUtc is correct regardless of host timezone
    $newTimeUtc = (Get-Date).ToUniversalTime().AddSeconds($offsetSec)
    try {
        $item = Get-Item -LiteralPath $targetPath -Force
        $item.LastWriteTimeUtc = $newTimeUtc
        Write-JsonLog "TOUCH_MTIME" (Get-RelativePath $targetPath) @{
            new_mtime_utc = $newTimeUtc.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            offset_s      = $offsetSec
        }
    } catch {
        Write-ErrorLog "TOUCH_MTIME" (Get-RelativePath $targetPath) $_.Exception.Message
    }
}

function Op-ChangeDirPerm {
    # Include share root itself
    $allDirs = @($Root) + $script:AllDirs
    if ($allDirs.Count -eq 0) { return }
    $targetPath = Pick-Random $allDirs

    try {
        $acl = Get-Acl -LiteralPath $targetPath

        # Find existing explicit (non-inherited) ACE for THIS exact principal.
        # Match by IdentityReference.Value (case-insensitive) - avoids the
        # accidental matches that "-like *X*" can produce.
        $existing = @($acl.Access | Where-Object {
            (-not $_.IsInherited) -and
            ($_.IdentityReference.Value -ieq $Principal)
        })

        if ($existing.Count -gt 0) {
            # ACE present -> remove it (toggle off)
            foreach ($e in $existing) { [void]$acl.RemoveAccessRule($e) }
            Set-Acl -LiteralPath $targetPath -AclObject $acl
            Write-JsonLog "CHANGE_DIR_PERM" (Get-RelativePath $targetPath) @{
                action    = "remove_ace"
                principal = $Principal
                rights    = $existing[0].FileSystemRights.ToString()
            }
        } else {
            # ACE absent -> add it (toggle on)
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                $Principal, "ReadAndExecute",
                "ContainerInherit,ObjectInherit",
                "None",
                "Allow"
            )
            $acl.AddAccessRule($rule)
            Set-Acl -LiteralPath $targetPath -AclObject $acl
            Write-JsonLog "CHANGE_DIR_PERM" (Get-RelativePath $targetPath) @{
                action    = "add_ace"
                principal = $Principal
                rights    = "ReadAndExecute"
                type      = "Allow"
            }
        }
    } catch {
        Write-ErrorLog "CHANGE_DIR_PERM" (Get-RelativePath $targetPath) $_.Exception.Message
    }
}

function Op-ChangeFilePerm {
    if ($script:AllFiles.Count -eq 0) { return }
    $targetPath = Pick-RandomFromList $script:AllFiles

    try {
        $acl = Get-Acl -LiteralPath $targetPath

        # Find existing explicit (non-inherited) ACE for THIS exact principal.
        $existing = @($acl.Access | Where-Object {
            (-not $_.IsInherited) -and
            ($_.IdentityReference.Value -ieq $Principal)
        })

        if ($existing.Count -gt 0) {
            # ACE present -> remove it (toggle off)
            foreach ($e in $existing) { [void]$acl.RemoveAccessRule($e) }
            Set-Acl -LiteralPath $targetPath -AclObject $acl
            Write-JsonLog "CHANGE_FILE_PERM" (Get-RelativePath $targetPath) @{
                action    = "remove_ace"
                principal = $Principal
                rights    = $existing[0].FileSystemRights.ToString()
            }
        } else {
            # ACE absent -> add it (toggle on)
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                $Principal, "ReadAndExecute", "None", "None", "Allow"
            )
            $acl.AddAccessRule($rule)
            Set-Acl -LiteralPath $targetPath -AclObject $acl
            Write-JsonLog "CHANGE_FILE_PERM" (Get-RelativePath $targetPath) @{
                action    = "add_ace"
                principal = $Principal
                rights    = "ReadAndExecute"
                type      = "Allow"
            }
        }
    } catch {
        Write-ErrorLog "CHANGE_FILE_PERM" (Get-RelativePath $targetPath) $_.Exception.Message
    }
}

function Op-CreateFile {
    $parentPath = if ($script:AllDirs.Count -gt 0) {
        Pick-Random $script:AllDirs
    } else {
        $Root
    }
    $fname  = "churn_{0:D6}_{1}.txt" -f $script:FileCounter, (Get-Random -Maximum 9999)
    $fpath  = Join-Path $parentPath $fname
    $size   = Get-Random -Maximum 4097   # 0-4096 bytes
    $bytes  = New-Object byte[] $size
    (New-Object System.Random).NextBytes($bytes)
    try {
        [System.IO.File]::WriteAllBytes($fpath, $bytes)
        # Only mutate state and log after the write succeeds
        $script:FileCounter++
        $script:AllFiles.Add($fpath)
        Write-JsonLog "CREATE_FILE" (Get-RelativePath $fpath) @{ size_bytes = $size }
    } catch {
        Write-ErrorLog "CREATE_FILE" (Get-RelativePath $fpath) $_.Exception.Message
    }
}

function Op-DeleteFile {
    # Keep at least 5 files in the tree
    if ($script:AllFiles.Count -le 5) { return }
    $targetPath = Pick-RandomFromList $script:AllFiles
    try {
        Remove-Item -LiteralPath $targetPath -Force
        # Remove from list only after successful delete
        [void]$script:AllFiles.Remove($targetPath)
        Write-JsonLog "DELETE_FILE" (Get-RelativePath $targetPath) @{}
    } catch {
        # File may be gone already (deleted externally) - remove from list anyway
        [void]$script:AllFiles.Remove($targetPath)
        Write-ErrorLog "DELETE_FILE" (Get-RelativePath $targetPath) $_.Exception.Message
    }
}

# ---------------------------------------------------------------------------
# Weighted operation picker
# ---------------------------------------------------------------------------
$OpsWithWeights = @(
    @{ fn = "Op-TouchMtime";     weight = 3 }
    @{ fn = "Op-ChangeDirPerm";  weight = 3 }
    @{ fn = "Op-ChangeFilePerm"; weight = 3 }
    @{ fn = "Op-CreateFile";     weight = 2 }
    @{ fn = "Op-DeleteFile";     weight = 1 }
)

function Pick-WeightedOp {
    $total = ($OpsWithWeights | Measure-Object -Property weight -Sum).Sum
    $r     = Get-Random -Maximum $total
    $cum   = 0
    foreach ($item in $OpsWithWeights) {
        $cum += $item.weight
        if ($r -lt $cum) { return $item.fn }
    }
    return $OpsWithWeights[-1].fn
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

# Normalise the path: trim any trailing slashes/backslashes.
# Avoid Resolve-Path because it fails on UNC paths that aren't mapped as a
# PS drive (e.g. \\server\share accessed directly by IP).
$Root = $Path.TrimEnd('\', '/')

# Mount the share with explicit credentials if -ShareUser was supplied.
if ($ShareUser -ne "") {
    $securePass = if ($SharePassword -ne "") {
        ConvertTo-SecureString $SharePassword -AsPlainText -Force
    } else {
        Read-Host "Password for $ShareUser" -AsSecureString
    }
    $cred = New-Object System.Management.Automation.PSCredential($ShareUser, $securePass)

    $driveName = "NdmChurnDrive"
    if (Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue) {
        Remove-PSDrive -Name $driveName -Force -ErrorAction SilentlyContinue
    }
    try {
        New-PSDrive -Name $driveName -PSProvider FileSystem -Root $Root `
                    -Credential $cred -Persist -ErrorAction Stop | Out-Null
        Write-Host "Mounted $Root as ${driveName}:"
    } catch {
        Write-Error "Failed to mount '$Root' as '$ShareUser': $($_.Exception.Message)"
        exit 1
    }
}

# Verify the path is actually reachable before proceeding.
if (-not (Test-Path -LiteralPath $Root)) {
    Write-Error "Cannot reach path '$Root'. Check the UNC path, credentials, and network connectivity."
    exit 1
}

$script:FileCounter  = 0

# Ensure log directory exists
$logDir = Split-Path -Parent $LogFile
if ($logDir -and -not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

# ---------------------------------------------------------------------------
# FOCUSED MODE - per-file worker scriptblock (runs in a PS thread job)
# ---------------------------------------------------------------------------
$FocusedWorkerScript = {
    param(
        [string] $FilePath,
        [string] $LogFile,
        [string] $Root,
        [int]    $DurationSeconds
    )

    # Create (or open existing) named mutex once per thread - never re-create per call
    $mutex = New-Object System.Threading.Mutex($false, "NdmChurnLogMutex")

    function Write-FocusedLog {
        param([string]$Op, [string]$RelPath, [string]$DetailJson)
        $ts   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        $line = "{`"ts`":`"$ts`",`"op`":`"$Op`",`"path`":`"$RelPath`",`"detail`":$DetailJson}"
        # Mutex-protected append so concurrent workers never interleave lines
        [void]$mutex.WaitOne()
        try { Add-Content -LiteralPath $LogFile -Value $line }
        finally { $mutex.ReleaseMutex() }
        Write-Host ("{0,-18}  {1}" -f $Op, $RelPath)
    }

    $rel = if ($FilePath.StartsWith($Root)) {
        $FilePath.Substring($Root.Length).TrimStart('\','/')
    } else { $FilePath }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()

    try {
        while ($true) {
            if ($DurationSeconds -gt 0 -and $sw.Elapsed.TotalSeconds -ge $DurationSeconds) { break }

            $offsetSec = if ((Get-Random -Maximum 2) -eq 0) { Get-Random -Minimum 1  -Maximum 30 } `
                         else                               { Get-Random -Minimum 30 -Maximum 60 }
            if ((Get-Random -Maximum 2) -eq 0) { $offsetSec = -$offsetSec }

            $newTimeUtc = (Get-Date).ToUniversalTime().AddSeconds($offsetSec)
            try {
                $item = Get-Item -LiteralPath $FilePath -Force
                $item.LastWriteTimeUtc = $newTimeUtc
                $mtimeStr = $newTimeUtc.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                Write-FocusedLog "TOUCH_MTIME" $rel "{`"new_mtime_utc`":`"$mtimeStr`",`"offset_s`":$offsetSec,`"mode`":`"focused`"}"
            } catch {
                $errMsg = $_.Exception.Message -replace '"', "'"
                Write-FocusedLog "TOUCH_MTIME_ERROR" $rel "{`"error`":`"$errMsg`",`"mode`":`"focused`"}"
            }
            # no sleep - hammer as fast as possible
        }
    } finally {
        $mutex.Dispose()
    }
}

# ---------------------------------------------------------------------------
# Entry: choose mode
# ---------------------------------------------------------------------------
$durationDisplay = if ($DurationSeconds -gt 0) { $DurationSeconds } else { "unlimited" }

# ── FOCUSED MODE ─────────────────────────────────────────────────────────────
if ($TargetFiles -ne "") {
    $targetArray = $TargetFiles -split ',' | ForEach-Object { $_.Trim() }

    foreach ($f in $targetArray) {
        if (-not (Test-Path -LiteralPath $f)) {
            Write-Error "Target file '$f' does not exist."
            exit 1
        }
    }

    Write-JsonLog "SCRIPT_START" $Root @{
        mode         = "focused"
        target_files = $TargetFiles
        duration_s   = $durationDisplay
        workers      = $targetArray.Count
        log          = $LogFile
    }
    Write-Host ("SMB churn (FOCUSED) - {0} parallel worker(s), no delay  (log -> {1})" -f $targetArray.Count, $LogFile)
    foreach ($f in $targetArray) { Write-Host "  worker: $f" }

    $startTime = [System.Diagnostics.Stopwatch]::StartNew()

    # Start one thread job per file
    $jobs = @()
    foreach ($f in $targetArray) {
        $jobs += Start-ThreadJob -ScriptBlock $FocusedWorkerScript `
                    -ArgumentList $f, $LogFile, $Root, $DurationSeconds
    }

    try {
        # Poll in 1-second ticks so Ctrl-C is caught promptly on all PS versions
        while ($true) {
            $allDone = ($jobs | Where-Object { $_.State -in 'Running','NotStarted' }).Count -eq 0
            if ($allDone) { break }
            Start-Sleep -Seconds 1
        }
    } finally {
        Stop-Job   -Job $jobs -ErrorAction SilentlyContinue
        Remove-Job -Job $jobs -ErrorAction SilentlyContinue
        Write-JsonLog "SCRIPT_STOP" $Root @{
            mode      = "focused"
            elapsed_s = [math]::Round($startTime.Elapsed.TotalSeconds, 2)
        }
        Write-Host "SMB churn finished."
    }
    exit 0
}

# ── RANDOM MODE ───────────────────────────────────────────────────────────────
Initialize-State

Write-JsonLog "SCRIPT_START" $Root @{
    mode         = "random"
    principal    = $Principal
    interval_s   = $IntervalSeconds
    batch_min    = $BatchMin
    batch_max    = $BatchMax
    duration_s   = $durationDisplay
    dirs_found   = $script:AllDirs.Count
    files_found  = $script:AllFiles.Count
    log          = $LogFile
}
Write-Host "SMB churn (RANDOM) started on $Root  (log -> $LogFile)"

$startTime = [System.Diagnostics.Stopwatch]::StartNew()

try {
    while ($true) {
        if ($DurationSeconds -gt 0 -and $startTime.Elapsed.TotalSeconds -ge $DurationSeconds) {
            break
        }

        # Random batch size for this tick
        $batchSize = Get-Random -Minimum $BatchMin -Maximum ($BatchMax + 1)
        for ($i = 0; $i -lt $batchSize; $i++) {
            $opName = Pick-WeightedOp
            & $opName
        }

        Start-Sleep -Seconds $IntervalSeconds
    }
} finally {
    Write-JsonLog "SCRIPT_STOP" $Root @{
        mode          = "random"
        files_created = $script:FileCounter
        elapsed_s     = [math]::Round($startTime.Elapsed.TotalSeconds, 2)
    }
    Write-Host "SMB churn finished."
}
