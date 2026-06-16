<#
.SYNOPSIS
    SMB continuous source-churn script.

.DESCRIPTION
    Runs indefinitely (or for -DurationSeconds) against a local SMB mount /
    UNC path, performing the operations below in random order and logging every
    action to a JSON-lines log file so the migration test can verify that all
    changes were captured by an incremental migration pass.

    The share is walked ONCE at startup.  The dir list is updated when dirs
    are created or deleted.  The file list is updated incrementally as files
    are created or deleted.

    MODE 1 - RANDOM (default):
      Operations performed:
        1. TOUCH_MTIME        - update LastWriteTime on a random file or folder
        2. CHANGE_DIR_PERM    - toggle the single Principal ACE on a random directory
        3. CHANGE_FILE_PERM   - toggle the single Principal ACE on a random file
        4. CREATE_FILE        - create a new file with random content
        5. DELETE_FILE        - delete a random file (keeps at least 5 files)
        6. CREATE_DIR         - create a new directory with 1-3 files inside
        7. DELETE_DIR         - delete a script-created directory + contents
        8. MODIFY_CONTENT     - overwrite existing file content with random bytes
        9. APPEND_DATA        - append random bytes to an existing file

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

.PARAMETER Principals
    Array of AD/local principals to toggle on ACEs.
    Each ACL operation picks a random principal from this list.
    Defaults to ROOTDOMAIN AD users (aclmap_u1-u5, Domain Users, Everyone).

.EXAMPLE
    # Run forever with default AD principals
    .\smb_churn.ps1 -Path "\\nas\src_share" -LogFile "C:\logs\smb_churn.log"

.EXAMPLE
    # Run for 10 minutes, 1-second interval
    .\smb_churn.ps1 -Path "Z:\" -LogFile "C:\logs\smb.log" `
        -DurationSeconds 600 -IntervalSeconds 1

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
    # AD principals to toggle on ACEs — these are real ANF users on the
    # ROOTDOMAIN AD, matching the ones used in TC-ACL-MISMATCH E2E tests.
    # The script cycles through them randomly per operation.
    [string[]] $Principals     = @(
        "ROOTDOMAIN\aclmap_u1",
        "ROOTDOMAIN\aclmap_u2",
        "ROOTDOMAIN\aclmap_u3",
        "ROOTDOMAIN\aclmap_u4",
        "ROOTDOMAIN\aclmap_u5",
        "ROOTDOMAIN\Domain Users",
        "Everyone"
    ),

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

    # Directories: live list (updated on create/delete)
    $script:AllDirs = New-Object 'System.Collections.Generic.List[string]'
    Get-ChildItem -LiteralPath $Root -Recurse -Directory -Force -ErrorAction SilentlyContinue |
        ForEach-Object { [void]$script:AllDirs.Add($_.FullName) }

    # Files: live list
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
    # Combine live dir list + live file list
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
    $allDirs = @($Root) + @($script:AllDirs)
    if ($allDirs.Count -eq 0) { return }
    $targetPath = Pick-Random $allDirs
    $principal  = Pick-Random $Principals

    try {
        $acl = Get-Acl -LiteralPath $targetPath

        $existing = @($acl.Access | Where-Object {
            (-not $_.IsInherited) -and
            ($_.IdentityReference.Value -ieq $principal)
        })

        if ($existing.Count -gt 0) {
            foreach ($e in $existing) { [void]$acl.RemoveAccessRule($e) }
            Set-Acl -LiteralPath $targetPath -AclObject $acl
            Write-JsonLog "CHANGE_DIR_PERM" (Get-RelativePath $targetPath) @{
                action    = "remove_ace"
                principal = $principal
                rights    = $existing[0].FileSystemRights.ToString()
            }
        } else {
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                $principal, "ReadAndExecute",
                "ContainerInherit,ObjectInherit",
                "None",
                "Allow"
            )
            $acl.AddAccessRule($rule)
            Set-Acl -LiteralPath $targetPath -AclObject $acl
            Write-JsonLog "CHANGE_DIR_PERM" (Get-RelativePath $targetPath) @{
                action    = "add_ace"
                principal = $principal
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
    $principal  = Pick-Random $Principals

    try {
        $acl = Get-Acl -LiteralPath $targetPath

        $existing = @($acl.Access | Where-Object {
            (-not $_.IsInherited) -and
            ($_.IdentityReference.Value -ieq $principal)
        })

        if ($existing.Count -gt 0) {
            foreach ($e in $existing) { [void]$acl.RemoveAccessRule($e) }
            Set-Acl -LiteralPath $targetPath -AclObject $acl
            Write-JsonLog "CHANGE_FILE_PERM" (Get-RelativePath $targetPath) @{
                action    = "remove_ace"
                principal = $principal
                rights    = $existing[0].FileSystemRights.ToString()
            }
        } else {
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                $principal, "ReadAndExecute", "None", "None", "Allow"
            )
            $acl.AddAccessRule($rule)
            Set-Acl -LiteralPath $targetPath -AclObject $acl
            Write-JsonLog "CHANGE_FILE_PERM" (Get-RelativePath $targetPath) @{
                action    = "add_ace"
                principal = $principal
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

function Op-CreateDir {
    $parentPath = if ($script:AllDirs.Count -gt 0) {
        Pick-RandomFromList $script:AllDirs
    } else {
        $Root
    }
    $dname = "churn_dir_{0:D6}_{1}" -f $script:DirCounter, (Get-Random -Maximum 9999)
    $dpath = Join-Path $parentPath $dname

    try {
        New-Item -ItemType Directory -Path $dpath -Force -ErrorAction Stop | Out-Null
        $script:DirCounter++
        $script:AllDirs.Add($dpath)
        Write-JsonLog "CREATE_DIR" (Get-RelativePath $dpath) @{}

        # Create 1-3 random files inside the new directory
        $fileCount = Get-Random -Minimum 1 -Maximum 4
        for ($fc = 0; $fc -lt $fileCount; $fc++) {
            $fname = "churn_{0:D6}_{1}.txt" -f $script:FileCounter, (Get-Random -Maximum 9999)
            $fpath = Join-Path $dpath $fname
            $size  = Get-Random -Minimum 1 -Maximum 4097
            $bytes = New-Object byte[] $size
            (New-Object System.Random).NextBytes($bytes)
            try {
                [System.IO.File]::WriteAllBytes($fpath, $bytes)
                $script:FileCounter++
                $script:AllFiles.Add($fpath)
                Write-JsonLog "CREATE_FILE" (Get-RelativePath $fpath) @{ size_bytes = $size; in_new_dir = $true }
            } catch {
                Write-ErrorLog "CREATE_FILE" (Get-RelativePath $fpath) $_.Exception.Message
            }
        }
    } catch {
        Write-ErrorLog "CREATE_DIR" (Get-RelativePath $dpath) $_.Exception.Message
    }
}

function Op-DeleteDir {
    # Only delete dirs created by this script (churn_dir_*), never originals
    if ($script:AllDirs.Count -le 3) { return }

    $candidates = @($script:AllDirs | Where-Object { (Split-Path $_ -Leaf) -like "churn_dir_*" })
    if ($candidates.Count -eq 0) { return }

    $targetPath = Pick-Random $candidates
    $rel = Get-RelativePath $targetPath

    try {
        Remove-Item -LiteralPath $targetPath -Recurse -Force -ErrorAction Stop

        # Remove dir and all its children from tracked lists
        [void]$script:AllDirs.Remove($targetPath)
        $childDirs = @($script:AllDirs | Where-Object { $_.StartsWith("$targetPath\") })
        foreach ($d in $childDirs) { [void]$script:AllDirs.Remove($d) }

        $childFiles = @($script:AllFiles | Where-Object { $_.StartsWith("$targetPath\") })
        foreach ($f in $childFiles) { [void]$script:AllFiles.Remove($f) }

        Write-JsonLog "DELETE_DIR" $rel @{}
    } catch {
        Write-ErrorLog "DELETE_DIR" $rel $_.Exception.Message
    }
}

function Op-ModifyContent {
    if ($script:AllFiles.Count -eq 0) { return }
    $targetPath = Pick-RandomFromList $script:AllFiles
    if (-not (Test-Path -LiteralPath $targetPath)) { return }

    try {
        $fileInfo = Get-Item -LiteralPath $targetPath -Force
        $origSize = [int]$fileInfo.Length
        if ($origSize -eq 0) { $origSize = 64 }
        $writeSize = [math]::Min($origSize, 65536)

        $bytes = New-Object byte[] $writeSize
        (New-Object System.Random).NextBytes($bytes)

        # Overwrite from the beginning without changing file size
        $stream = [System.IO.File]::OpenWrite($targetPath)
        try {
            $stream.Position = 0
            $stream.Write($bytes, 0, $writeSize)
        } finally {
            $stream.Close()
        }

        Write-JsonLog "MODIFY_CONTENT" (Get-RelativePath $targetPath) @{
            size_bytes = $origSize
            written    = $writeSize
        }
    } catch {
        Write-ErrorLog "MODIFY_CONTENT" (Get-RelativePath $targetPath) $_.Exception.Message
    }
}

function Op-AppendData {
    if ($script:AllFiles.Count -eq 0) { return }
    $targetPath = Pick-RandomFromList $script:AllFiles
    if (-not (Test-Path -LiteralPath $targetPath)) { return }

    try {
        $appendSize = Get-Random -Minimum 1 -Maximum 1025   # 1-1024 bytes
        $bytes = New-Object byte[] $appendSize
        (New-Object System.Random).NextBytes($bytes)

        $stream = [System.IO.File]::Open($targetPath, [System.IO.FileMode]::Append)
        try {
            $stream.Write($bytes, 0, $appendSize)
        } finally {
            $stream.Close()
        }

        Write-JsonLog "APPEND_DATA" (Get-RelativePath $targetPath) @{ appended_bytes = $appendSize }
    } catch {
        Write-ErrorLog "APPEND_DATA" (Get-RelativePath $targetPath) $_.Exception.Message
    }
}

# ---------------------------------------------------------------------------
# Weighted operation picker
# Weights: mtime=2, dir_perm=2, file_perm=2, create_file=2, delete_file=1,
#          create_dir=2, delete_dir=1, modify_content=2, append_data=2  (sum=16)
# Flat arrays avoid Measure-Object issues with hashtable properties in strict mode.
# ---------------------------------------------------------------------------
$OpNames   = @("Op-TouchMtime","Op-ChangeDirPerm","Op-ChangeFilePerm","Op-CreateFile","Op-DeleteFile","Op-CreateDir","Op-DeleteDir","Op-ModifyContent","Op-AppendData")
$OpWeights = @(2,              2,                  2,                   2,              1,              2,             1,             2,                 2)
$OpWeightTotal = 0; foreach ($w in $OpWeights) { $OpWeightTotal += $w }

function Pick-WeightedOp {
    $r   = Get-Random -Maximum $OpWeightTotal
    $cum = 0
    for ($i = 0; $i -lt $OpNames.Count; $i++) {
        $cum += $OpWeights[$i]
        if ($r -lt $cum) { return $OpNames[$i] }
    }
    return $OpNames[-1]
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
$script:DirCounter   = 0

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
    principals   = ($Principals -join ", ")
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
        dirs_created  = $script:DirCounter
        elapsed_s     = [math]::Round($startTime.Elapsed.TotalSeconds, 2)
    }
    Write-Host "SMB churn finished."
}
