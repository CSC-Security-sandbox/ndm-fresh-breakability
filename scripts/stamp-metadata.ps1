<#
.SYNOPSIS
    Stamps all file metadata (NTFS ACLs, owner, group, timestamps, attributes)
    from a source SMB share to a destination SMB share.

.DESCRIPTION
    Mounts source and destination SMB shares, reads metadata from a CSV input file
    listing source-to-destination path mappings, and mirrors all NTFS properties.
    Uses the same FastAcl P/Invoke layer and Get-FileSecurityFast / Set-FileSecurityFast
    functions as the NDM worker service (powershell.script.ts).

.PARAMETER SourceHost
    Hostname or IP address of the source SMB server (e.g. srcserver or 192.168.1.10)

.PARAMETER SourceShare
    Share name (or path) on the source server (e.g. nfs_share or /srv/nfs_share).
    Leading slashes are stripped automatically. Combined with SourceHost to form
    the UNC path \\SourceHost\SourceShare used for mounting.

.PARAMETER DestHost
    Hostname or IP address of the destination SMB server (e.g. dstserver or 192.168.1.20)

.PARAMETER DestShare
    Share name (or path) on the destination server (e.g. nfs_share or /srv/nfs_share).
    Leading slashes are stripped automatically. Combined with DestHost to form
    the UNC path \\DestHost\DestShare used for mounting.

.PARAMETER SourceUsername
    SMB username for the source share (DOMAIN\user or user@domain)

.PARAMETER SourcePassword
    SMB password for the source share

.PARAMETER DestUsername
    SMB username for the destination share. Defaults to SourceUsername.

.PARAMETER DestPassword
    SMB password for the destination share. Defaults to SourcePassword.

.PARAMETER InputFile
    CSV file with a column named 'Source Path' containing absolute paths
    (e.g. /srv/nfs_share/file.txt). An optional 'Destination Path' column may
    also be present; when it is, its value is used as the destination path
    instead of mirroring the source path. Any other columns are ignored.
    The share prefix (derived from SourceShare / DestShare) is automatically
    stripped from each path so only the share-relative portion is used, e.g.:
      /srv/nfs_share/subdir/file.txt  ->  subdir\file.txt  ->  S:\subdir\file.txt
    If omitted, all items on the source share are processed.

.PARAMETER LogFile
    Path to the log file. Defaults to stamp-metadata-<timestamp>.log

.PARAMETER ErrorFile
    Path to write per-item errors. Defaults to stamp-metadata-<timestamp>-errors.log

.PARAMETER SidMapFile
    Optional. Path to a CSV file that maps source identities to destination identities.
    Required columns: SourceSID, DestSID
    Values may be SID strings (S-1-...) or usernames (DOMAIN\user or user@domain).
    Usernames are resolved to SIDs at load time:
      - If already qualified (DOMAIN\name or user@domain) -> translate directly
      - If -Domain is provided -> use Domain\name directly (no COMPUTERNAME/USERDOMAIN guessing)
      - If -Domain is not provided -> fall back to COMPUTERNAME\name, then USERDOMAIN\name
    When provided, every SID in Owner, Group, and all DACL ACEs is translated before
    stamping. SIDs absent from the map are stamped as-is (raw SID string).
    Set DestSID to "Invalid" to explicitly drop an ACE for that SID.

    Both the NDM UI column names and alternative names are accepted:
      NDM UI format:   sid_source,sid_target   (matches the CSV downloaded from NDM UI)
      Alternative:     SourceSID,DestSID

    Example CSV (NDM UI format, usernames):
        sid_source,sid_target
        user1,user2
        user3,Invalid
    (use -Domain "rootdomain" if the machine running the script is not domain-joined)

    Example CSV (NDM UI format, qualified usernames - no -Domain needed):
        sid_source,sid_target
        rootdomain\user1,destdomain\user1
        rootdomain\user2,Invalid

    Example CSV (NDM UI format, SIDs):
        sid_source,sid_target
        S-1-5-21-111-222-333-1001,S-1-5-21-444-555-666-1001
        S-1-5-21-111-222-333-1002,Invalid

    Example CSV (alternative format, mixed):
        SourceSID,DestSID
        rootdomain\user1,S-1-5-21-444-555-666-1001
        S-1-5-21-111-222-333-1002,destdomain\user2

.PARAMETER Domain
    Optional. NetBIOS domain name to use when resolving unqualified usernames in
    the SidMapFile (e.g. "rootdomain"). When provided, unqualified names are resolved
    as Domain\name directly — COMPUTERNAME and USERDOMAIN are not used.
    If the username is already qualified (DOMAIN\user or user@domain) this parameter
    is not used for that entry.

.EXAMPLE
    .\stamp-metadata.ps1 -SourceHost "srcserver" -SourceShare "nfs_share" `
        -DestHost "dstserver" -DestShare "nfs_share" `
        -SourceUsername "DOMAIN\admin" -SourcePassword "P@ss"

.EXAMPLE
    .\stamp-metadata.ps1 -SourceHost "srcserver" -SourceShare "/srv/nfs_share" `
        -DestHost "dstserver" -DestShare "/srv/nfs_share" `
        -SourceUsername "DOMAIN\srcadmin" -SourcePassword "SrcP@ss" `
        -DestUsername "DOMAIN\dstadmin" -DestPassword "DstP@ss" `
        -InputFile "metadata_conflict_errors.csv" -SidMapFile "sid-map.csv" `
        -Domain "rootdomain"
#>

param(
    [Parameter(Mandatory=$true)] [string]$SourceHost,
    [Parameter(Mandatory=$true)] [string]$SourceShare,
    [Parameter(Mandatory=$true)] [string]$DestHost,
    [Parameter(Mandatory=$true)] [string]$DestShare,
    [Parameter(Mandatory=$true)] [string]$SourceUsername,
    [Parameter(Mandatory=$true)] [string]$SourcePassword,
    [string]$DestUsername,
    [string]$DestPassword,
    [string]$InputFile,
    [string]$LogFile,
    [string]$ErrorFile,
    [string]$SidMapFile,
    [string]$Domain
)

if (-not $DestUsername) { $DestUsername = $SourceUsername }
if (-not $DestPassword) { $DestPassword = $SourcePassword }

# Normalize share names: strip leading slashes so "/srv/nfs_share" -> "srv\nfs_share"
$SourceShare = ($SourceShare.Trim() -replace '^[/\\]+', '') -replace '/', '\'
$DestShare   = ($DestShare.Trim()   -replace '^[/\\]+', '') -replace '/', '\'

# Normalize hosts: strip any leading \\ in case user passed a UNC-style host
$SourceHost = $SourceHost.Trim().TrimStart('\')
$DestHost   = $DestHost.Trim().TrimStart('\')

# Build UNC paths from host + share
$SourceUNC = "\\$SourceHost\$SourceShare"
$DestUNC   = "\\$DestHost\$DestShare"

$tsStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (-not $LogFile)   { $LogFile   = "stamp-metadata-${tsStamp}.log" }
if (-not $ErrorFile) { $ErrorFile = "stamp-metadata-${tsStamp}-errors.log" }

$failedItems = @()
$srcMounted  = $false
$dstMounted  = $false
$totalItems  = 0

# =============================================================================
# Logging
# =============================================================================

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $ts   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] [$Level] $Message"
    switch ($Level) {
        "ERROR" { Write-Host $line -ForegroundColor Red    }
        "WARN"  { Write-Host $line -ForegroundColor Yellow }
        default { Write-Host $line }
    }
    $line | Out-File -Append -FilePath $LogFile -Encoding UTF8
}

function Write-Error-Entry {
    param([string]$SrcPath, [string]$DstPath, [string]$Stage, [string]$ErrorMsg)
    $ts    = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "[$ts] [$Stage] SRC=$SrcPath | DST=$DstPath | ERROR=$ErrorMsg"
    $entry | Out-File -Append -FilePath $ErrorFile -Encoding UTF8
}

# =============================================================================
# Parameter validation
# =============================================================================

if ([string]::IsNullOrWhiteSpace($SourceHost))  { Write-Log "SourceHost cannot be empty"  "ERROR"; exit 1 }
if ([string]::IsNullOrWhiteSpace($SourceShare)) { Write-Log "SourceShare cannot be empty" "ERROR"; exit 1 }
if ([string]::IsNullOrWhiteSpace($DestHost))    { Write-Log "DestHost cannot be empty"    "ERROR"; exit 1 }
if ([string]::IsNullOrWhiteSpace($DestShare))   { Write-Log "DestShare cannot be empty"   "ERROR"; exit 1 }

if ($SourceUNC -eq $DestUNC) {
    Write-Log "Source and destination resolve to the same UNC path [$SourceUNC]. Aborting." "ERROR"; exit 1
}
if ([string]::IsNullOrWhiteSpace($SourceUsername)) {
    Write-Log "SourceUsername cannot be empty" "ERROR"; exit 1
}
if ([string]::IsNullOrWhiteSpace($SourcePassword)) {
    Write-Log "SourcePassword cannot be empty" "ERROR"; exit 1
}
if ($InputFile) {
    if (-not (Test-Path $InputFile)) {
        Write-Log "InputFile not found: $InputFile" "ERROR"; exit 1
    }
    if ([System.IO.Path]::GetExtension($InputFile).ToLower() -ne ".csv") {
        Write-Log "InputFile must be a .csv file. Got: $InputFile" "ERROR"; exit 1
    }
}
if ($SidMapFile) {
    if (-not (Test-Path $SidMapFile)) {
        Write-Log "SidMapFile not found: $SidMapFile" "ERROR"; exit 1
    }
    if ([System.IO.Path]::GetExtension($SidMapFile).ToLower() -ne ".csv") {
        Write-Log "SidMapFile must be a .csv file. Got: $SidMapFile" "ERROR"; exit 1
    }
}

# =============================================================================
# P/Invoke type definitions  (FastAcl + MarshalHelpers)
# Source: powershell.script.ts  ->  psBaseAclDefinition
# =============================================================================

try {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;

public class FastAcl {
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint GetNamedSecurityInfo(
        string pObjectName,
        uint ObjectType,
        uint SecurityInfo,
        out IntPtr ppsidOwner,
        out IntPtr ppsidGroup,
        out IntPtr ppDacl,
        out IntPtr ppSacl,
        out IntPtr ppSecurityDescriptor
    );

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint SetNamedSecurityInfo(
        string pObjectName,
        uint ObjectType,
        int SecurityInfo,
        IntPtr psidOwner,
        IntPtr psidGroup,
        IntPtr pDacl,
        IntPtr pSacl
    );
}

public class MarshalHelpers {
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern int GetSecurityDescriptorLength(IntPtr pSecurityDescriptor);
}
"@ -ErrorAction Stop
} catch {
    if ($_.Exception.Message -notlike "*already exists*") {
        Write-Log "Failed to load FastAcl P/Invoke types: $($_.Exception.Message)" "ERROR"
        exit 1
    }
}

# =============================================================================
# Backup/Restore privilege helper  (TokenManipulator)
# Source: powershell.script.ts  ->  psEnableBackupPrivilegeScript
# =============================================================================

try {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;

public class TokenManipulator {
    [DllImport("advapi32.dll", SetLastError = true)]
    internal static extern bool AdjustTokenPrivileges(IntPtr htok, bool disall,
        ref TokPriv1Luid newst, int len, IntPtr prev, IntPtr relen);

    [DllImport("advapi32.dll", SetLastError = true)]
    internal static extern bool OpenProcessToken(IntPtr h, int acc, ref IntPtr phtok);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    internal static extern bool LookupPrivilegeValue(string host, string name, ref long pluid);

    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern IntPtr GetCurrentProcess();

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    internal struct TokPriv1Luid {
        public int Count;
        public long Luid;
        public int Attr;
    }

    internal const int SE_PRIVILEGE_ENABLED    = 0x00000002;
    internal const int TOKEN_QUERY             = 0x00000008;
    internal const int TOKEN_ADJUST_PRIVILEGES = 0x00000020;

    public static string EnablePrivilege(string privilegeName) {
        IntPtr hToken = IntPtr.Zero;
        try {
            IntPtr hProc = GetCurrentProcess();
            if (!OpenProcessToken(hProc, TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, ref hToken))
                return "FAILED: OpenProcessToken - " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
            long luid = 0;
            if (!LookupPrivilegeValue(null, privilegeName, ref luid))
                return "FAILED: LookupPrivilegeValue for " + privilegeName;
            TokPriv1Luid tp = new TokPriv1Luid();
            tp.Count = 1; tp.Luid = luid; tp.Attr = SE_PRIVILEGE_ENABLED;
            if (!AdjustTokenPrivileges(hToken, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero))
                return "FAILED: AdjustTokenPrivileges - " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
            return Marshal.GetLastWin32Error() == 1300 ? "FAILED: Privilege not assigned to user" : "SUCCESS";
        } catch (Exception ex) {
            return "FAILED: " + ex.Message;
        } finally {
            if (hToken != IntPtr.Zero) CloseHandle(hToken);
        }
    }
}
"@ -ErrorAction SilentlyContinue
} catch {}

function Enable-Privilege([string]$privilegeName) {
    try   { return [TokenManipulator]::EnablePrivilege($privilegeName) }
    catch { return "FAILED: $($_.Exception.Message)" }
}

# =============================================================================
# Security constants
# Source: powershell.script.ts  ->  psBaseAclDefinition
# =============================================================================

$SE_FILE_OBJECT                        = 1
$OWNER_SECURITY_INFORMATION            = 0x00000001
$GROUP_SECURITY_INFORMATION            = 0x00000002
$DACL_SECURITY_INFORMATION             = 0x00000004
$PROTECTED_DACL_SECURITY_INFORMATION   = [int]0x80000000
$UNPROTECTED_DACL_SECURITY_INFORMATION = 0x20000000
$ALL_SECURITY_INFORMATION              = $OWNER_SECURITY_INFORMATION -bor $GROUP_SECURITY_INFORMATION -bor $DACL_SECURITY_INFORMATION

# =============================================================================
# Helper: SID resolvability check
# Source: powershell.script.ts  ->  psBaseAclDefinition  Map-Sid
# =============================================================================

function Map-Sid {
    param($sid)
    try   { $null = $sid.Translate([System.Security.Principal.NTAccount]).Value; return $true }
    catch { return $false }
}

# =============================================================================
# SID mapping table  (optional, loaded from -SidMapFile)
# CSV format:  SourceSID,DestSID
# Values may be SID strings (S-1-...) or usernames (DOMAIN\user / user@domain).
# Mirrors NDM's identity-mapping behaviour (mapping-resolver.service.ts +
# Resolve-UsernamesToSid in powershell.script.ts).
# =============================================================================

$script:sidMap = @{}

# Resolve a single account name to a SID string using the same fallback chain
# NDM uses in Resolve-UsernamesToSid (powershell.script.ts):
#   1. Already a SID (starts with S-1-)  -> return as-is
#   2. DOMAIN\name or UPN (contains \ or @) -> translate directly
#   3. COMPUTERNAME\name
#   4. USERDOMAIN\name
#   5. Unresolvable -> return "Invalid"
function Resolve-AccountToSid([string]$account, [string]$domain = "") {
    if ([string]::IsNullOrWhiteSpace($account)) { return "Invalid" }
    $account = $account.Trim()

    # Already a SID
    if ($account -match '^S-1-') { return $account }

    # "Invalid" is a special sentinel value - pass through unchanged
    if ($account -eq "Invalid") { return "Invalid" }

    function Try-Translate([string]$acct) {
        try {
            return ([System.Security.Principal.NTAccount]$acct).Translate(
                [System.Security.Principal.SecurityIdentifier]).Value
        } catch { return $null }
    }

    $computer   = $env:COMPUTERNAME
    $userdomain = $env:USERDOMAIN
    $sid        = $null

    Write-Log "Resolve-AccountToSid: account='$account' | COMPUTERNAME='$computer' | USERDOMAIN='$userdomain' | Domain param='$domain'"

    # Qualified (DOMAIN\name) or UPN (user@domain) -> try as-is
    if ($account -like '*\*' -or $account -like '*@*') {
        $sid = Try-Translate $account
        Write-Log "Resolve-AccountToSid: try as-is '$account' -> $(if ($sid) { $sid } else { 'null' })"
    }

    if (-not $sid) {
        if (-not [string]::IsNullOrWhiteSpace($domain)) {
            # -Domain explicitly provided: use it directly, skip COMPUTERNAME/USERDOMAIN guesses
            $sid = Try-Translate "$domain\$account"
            Write-Log "Resolve-AccountToSid: try '$domain\$account' -> $(if ($sid) { $sid } else { 'null' })"
        } else {
            # No -Domain provided: fall back to COMPUTERNAME then USERDOMAIN
            $sid = Try-Translate "$computer\$account"
            Write-Log "Resolve-AccountToSid: try '$computer\$account' -> $(if ($sid) { $sid } else { 'null' })"
            if (-not $sid -and $userdomain) {
                $sid = Try-Translate "$userdomain\$account"
                Write-Log "Resolve-AccountToSid: try '$userdomain\$account' -> $(if ($sid) { $sid } else { 'null' })"
            }
        }
    }

    if ($sid) { return $sid }

    Write-Log "Could not resolve '$account' to a SID - will mark as Invalid" "WARN"
    return "Invalid"
}

function Import-SidMap([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path)) { return }

    try {
        $rows = Import-Csv $path -ErrorAction Stop
    } catch {
        Write-Log "Failed to read SidMapFile '$path': $($_.Exception.Message)" "ERROR"; exit 1
    }
    if (-not $rows -or $rows.Count -eq 0) {
        Write-Log "SidMapFile is empty: $path" "WARN"; return
    }

    $cols = $rows[0].PSObject.Properties.Name

    # Accept both NDM UI column names (sid_source/sid_target) and our own (SourceSID/DestSID)
    $srcCol = $null
    $dstCol = $null
    if ($cols -contains "sid_source" -and $cols -contains "sid_target") {
        $srcCol = "sid_source"; $dstCol = "sid_target"
        Write-Log "SidMapFile: using NDM column names (sid_source / sid_target)"
    } elseif ($cols -contains "SourceSID" -and $cols -contains "DestSID") {
        $srcCol = "SourceSID"; $dstCol = "DestSID"
        Write-Log "SidMapFile: using column names SourceSID / DestSID"
    } else {
        Write-Log "SidMapFile must have columns 'sid_source,sid_target' or 'SourceSID,DestSID'. Found: $($cols -join ', ')" "ERROR"; exit 1
    }

    $resolved = 0
    foreach ($row in $rows) {
        $src = $row.$srcCol.Trim()
        $dst = $row.$dstCol.Trim()
        if ([string]::IsNullOrWhiteSpace($src) -or [string]::IsNullOrWhiteSpace($dst)) { continue }

        # Resolve usernames -> SIDs (mirrors NDM's Resolve-UsernamesToSid)
        $srcSid = Resolve-AccountToSid $src $Domain
        $dstSid = Resolve-AccountToSid $dst $Domain

        if ($srcSid -eq "Invalid") {
            Write-Log "SID map: could not resolve source '$src' - skipping entry" "WARN"
            continue
        }

        if ($srcSid -ne $src) { Write-Log "SID map  resolved source : $src -> $srcSid" }
        if ($dstSid -ne $dst) { Write-Log "SID map  resolved dest   : $dst -> $dstSid" }

        $script:sidMap[$srcSid] = $dstSid
        $resolved++
    }
    Write-Log "Loaded $resolved SID mapping(s) from $path (of $($rows.Count) rows)"
}

# Applies the SID map to an ACL JSON string.
# - Owner and Group SIDs are translated if a mapping exists.
# - Each ACE SID is translated if a mapping exists.
# - ACEs whose DestSID is "Invalid" are dropped (same behaviour as NDM).
# - SIDs not present in the map are left unchanged.
# Returns the (possibly modified) ACL JSON string.
function Resolve-AclSids([string]$aclJson) {
    if ($script:sidMap.Count -eq 0) { return $aclJson }

    $acl = $aclJson | ConvertFrom-Json

    if ($script:sidMap.ContainsKey($acl.Owner)) {
        $mapped = $script:sidMap[$acl.Owner]
        Write-Log "SID map  Owner : $($acl.Owner) -> $mapped"
        $acl.Owner = $mapped
    }

    if ($script:sidMap.ContainsKey($acl.Group)) {
        $mapped = $script:sidMap[$acl.Group]
        Write-Log "SID map  Group : $($acl.Group) -> $mapped"
        $acl.Group = $mapped
    }

    $resolvedAces = [System.Collections.Generic.List[object]]::new()
    foreach ($ace in $acl.DaclAces) {
        if ($script:sidMap.ContainsKey($ace.Sid)) {
            $mapped = $script:sidMap[$ace.Sid]
            if ($mapped -eq "Invalid") {
                Write-Log "SID map  ACE  : $($ace.Sid) -> dropped (Invalid)" "WARN"
                continue
            }
            Write-Log "SID map  ACE  : $($ace.Sid) -> $mapped"
            $ace.Sid = $mapped
        }
        $resolvedAces.Add($ace)
    }
    $acl.DaclAces = $resolvedAces.ToArray()

    return ($acl | ConvertTo-Json -Compress)
}

# =============================================================================
# Get-FileSecurityFast
# Reads NTFS owner, group, DACL, and file attributes from $path.
# Returns a compact JSON string compatible with Set-FileSecurityFast.
# Source: powershell.script.ts  ->  psBaseAclDefinition
# =============================================================================

function Get-FileSecurityFast([string]$path) {
    $pOwnerSid = [IntPtr]::Zero
    $pGroupSid = [IntPtr]::Zero
    $pDacl     = [IntPtr]::Zero
    $pSacl     = [IntPtr]::Zero
    $pSD       = [IntPtr]::Zero

    try {
        $result = [FastAcl]::GetNamedSecurityInfo(
            $path, $SE_FILE_OBJECT, $ALL_SECURITY_INFORMATION,
            [ref]$pOwnerSid, [ref]$pGroupSid, [ref]$pDacl, [ref]$pSacl, [ref]$pSD)
    } catch {
        throw "Error reading security info: $_"
    }
    if ($result -ne 0) { throw "GetNamedSecurityInfo failed [$result] for: $path" }

    $sdLength = [MarshalHelpers]::GetSecurityDescriptorLength($pSD)
    $sdBytes  = New-Object byte[] $sdLength
    [System.Runtime.InteropServices.Marshal]::Copy($pSD, $sdBytes, 0, $sdLength)
    $sd = New-Object System.Security.AccessControl.RawSecurityDescriptor($sdBytes, 0)

    $daclAces = @()
    if ($sd.DiscretionaryAcl) {
        foreach ($ace in $sd.DiscretionaryAcl) {
            $daclAces += [PSCustomObject]@{
                Sid         = $ace.SecurityIdentifier.Value
                AccessMask  = $ace.AccessMask
                AceType     = [int]$ace.AceType
                AceFlags    = [int]$ace.AceFlags
                IsInherited = $ace.IsInherited
            }
        }
    }

    $attributes = "Normal"
    try { $attributes = [System.IO.File]::GetAttributes($path).ToString() } catch {}

    $ctrl            = $sd.Control
    $daclPresent     = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclPresent) -ne 0
    $daclProtected   = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -ne 0
    $daclAutoInherit = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherited) -ne 0

    if ($sd.DiscretionaryAcl -and $sd.DiscretionaryAcl.Count -gt 0) { $daclPresent = $true }

    $hasInheritedAces = $false
    if ($sd.DiscretionaryAcl) {
        foreach ($ace in $sd.DiscretionaryAcl) {
            if ($ace.IsInherited) { $hasInheritedAces = $true; break }
        }
    }
    if (-not $hasInheritedAces -and $daclPresent) { $daclProtected = $true }

    [PSCustomObject]@{
        Owner           = $sd.Owner.Value
        Group           = $sd.Group.Value
        DaclAces        = $daclAces
        DaclPresent     = $daclPresent
        DaclProtected   = $daclProtected
        DaclAutoInherit = $daclAutoInherit
        Attributes      = $attributes
    } | ConvertTo-Json -Compress
}

# =============================================================================
# Set-FileSecurityFast
# Applies NTFS owner, group, DACL, and file attributes from an ACL JSON string
# (as produced by Get-FileSecurityFast) to $path.
# Returns an array of unresolved SID strings (empty array on full success).
#
# Source: powershell.script.ts  ->  psBaseAclDefinition
# Fixes applied vs. original:
#   1. CommonAce 5th arg is isCallback, not isInherited - always pass $false.
#   2. Strip Inherited bit (0x10) from AceFlags so all ACEs are explicit on dest.
#   3. Always use PROTECTED_DACL_SECURITY_INFORMATION so Windows does not discard
#      the stamped ACEs and replace them with the destination parent's inherited ACEs.
# =============================================================================

function Set-FileSecurityFast([string]$path, [string]$aclJson) {
    $securityInfo   = $aclJson | ConvertFrom-Json
    $unresolvedSids = @()

    $ownerSid = New-Object System.Security.Principal.SecurityIdentifier($securityInfo.Owner)
    $groupSid = New-Object System.Security.Principal.SecurityIdentifier($securityInfo.Group)

    if (-not (Map-Sid $ownerSid)) { $unresolvedSids += $ownerSid.Value }
    if (-not (Map-Sid $groupSid)) { $unresolvedSids += $groupSid.Value }

    $sd = New-Object System.Security.AccessControl.RawSecurityDescriptor('O:BAG:BAD:')
    $sd.Owner = $ownerSid
    $sd.Group = $groupSid

    $aces = $securityInfo.DaclAces
    $dacl = New-Object System.Security.AccessControl.RawAcl(2, $aces.Count)

    for ($i = 0; $i -lt $aces.Count; $i++) {
        $ace = $aces[$i]
        $sid = New-Object System.Security.Principal.SecurityIdentifier($ace.Sid)
        if (-not (Map-Sid $sid)) { $unresolvedSids += $sid.Value }

        $qualifier = if ($ace.AceType -eq 0) {
            [System.Security.AccessControl.AceQualifier]::AccessAllowed
        } elseif ($ace.AceType -eq 1) {
            [System.Security.AccessControl.AceQualifier]::AccessDenied
        } else {
            throw "Unsupported ACE type $($ace.AceType) in ACE $i for: $path"
        }

        # Strip the Inherited bit (0x10) - all source ACEs become explicit on destination.
        # Propagation flags (ContainerInherit=0x2, ObjectInherit=0x1, etc.) are preserved.
        $aceFlags  = [System.Security.AccessControl.AceFlags]($ace.AceFlags -band (-bnot 0x10))
        # 5th param is isCallback (not isInherited) - must be $false for standard NTFS ACEs.
        $commonAce = New-Object System.Security.AccessControl.CommonAce(
            $aceFlags, $qualifier, [int]$ace.AccessMask, $sid, $false, $null)
        $dacl.InsertAce($i, $commonAce)
    }
    $sd.DiscretionaryAcl = $dacl

    $flags = [System.Security.AccessControl.ControlFlags]::DiscretionaryAclPresent -bor
             [System.Security.AccessControl.ControlFlags]::SelfRelative
    if ($securityInfo.DaclProtected)   { $flags = $flags -bor [System.Security.AccessControl.ControlFlags]::DiscretionaryAclProtected }
    if ($securityInfo.DaclAutoInherit) { $flags = $flags -bor [System.Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherit }
    $sd.SetFlags($flags)

    $ownerBytes = New-Object byte[] ($sd.Owner.BinaryLength)
    $sd.Owner.GetBinaryForm($ownerBytes, 0)
    $ptrOwner = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($ownerBytes.Length)
    [System.Runtime.InteropServices.Marshal]::Copy($ownerBytes, 0, $ptrOwner, $ownerBytes.Length)

    $groupBytes = New-Object byte[] ($sd.Group.BinaryLength)
    $sd.Group.GetBinaryForm($groupBytes, 0)
    $ptrGroup = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($groupBytes.Length)
    [System.Runtime.InteropServices.Marshal]::Copy($groupBytes, 0, $ptrGroup, $groupBytes.Length)

    $daclBytes = New-Object byte[] ($dacl.BinaryLength)
    $dacl.GetBinaryForm($daclBytes, 0)
    $ptrDacl = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($daclBytes.Length)
    [System.Runtime.InteropServices.Marshal]::Copy($daclBytes, 0, $ptrDacl, $daclBytes.Length)

    try {
        # Always protect the destination DACL so Windows does not discard the stamped ACEs
        # and replace them with the destination parent container's inherited ACEs.
        $secFlags = [int](
            $OWNER_SECURITY_INFORMATION -bor
            $GROUP_SECURITY_INFORMATION -bor
            $DACL_SECURITY_INFORMATION  -bor
            $PROTECTED_DACL_SECURITY_INFORMATION
        )

        $result = [FastAcl]::SetNamedSecurityInfo(
            $path, $SE_FILE_OBJECT, $secFlags,
            $ptrOwner, $ptrGroup, $ptrDacl, [IntPtr]::Zero)

        if ($result -ne 0) {
            $win32Msg = ([System.ComponentModel.Win32Exception]$result).Message
            throw "SetNamedSecurityInfo error $result ($win32Msg) for: $path"
        }

        if ($securityInfo.Attributes) {
            try {
                $attrEnum = [System.Enum]::Parse([System.IO.FileAttributes], $securityInfo.Attributes)
                [System.IO.File]::SetAttributes($path, $attrEnum)
            } catch {
                Write-Log "Could not set attributes on $path : $($_.Exception.Message)" "WARN"
                Write-Error-Entry "" $path "SET_ATTR" $_.Exception.Message
            }
        }
    } finally {
        [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrOwner)
        [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrGroup)
        [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrDacl)
    }

    return $unresolvedSids
}

# =============================================================================
# Set-FileTimestamps
# Copies CreationTime, LastWriteTime, LastAccessTime from source to destination.
# (Timestamps are not included in Get-FileSecurityFast / Set-FileSecurityFast.)
# =============================================================================

function Set-FileTimestamps([string]$srcPath, [string]$dstPath) {
    $src = Get-Item -LiteralPath $srcPath -Force -ErrorAction Stop
    $dst = Get-Item -LiteralPath $dstPath -Force -ErrorAction Stop
    $dst.CreationTimeUtc   = $src.CreationTimeUtc
    $dst.LastWriteTimeUtc  = $src.LastWriteTimeUtc
    $dst.LastAccessTimeUtc = $src.LastAccessTimeUtc
}

# =============================================================================
# SMB mount/unmount helpers
# =============================================================================

function Mount-Share([string]$drive, [string]$share, [string]$user, [string]$pass, [string]$label) {
    Write-Log "Mounting $label share to $drive [$share as $user]"

    $server  = ($share.TrimStart('\') -split '\\')[0]
    $tcpTest = Test-NetConnection -ComputerName $server -Port 445 -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
    if (-not $tcpTest.TcpTestSucceeded) {
        Write-Log "Cannot reach $server on port 445. Check network/VPN/firewall." "ERROR"; exit 1
    }

    $oldPref = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    net use $drive /delete /y 2>&1 | Out-Null
    $ErrorActionPreference = $oldPref

    $mountOutput = net use $drive $share /user:$user $pass 2>&1
    if ($LASTEXITCODE -ne 0) {
        $winErrCode = 0
        $outputStr  = "$mountOutput"
        if ($outputStr -match 'System error (\d+)') { $winErrCode = [int]$Matches[1] }

        $errDetail = switch ($winErrCode) {
            2    { "Server or share not found. Check the UNC path." }
            5    { "Access denied. Check credentials and share permissions." }
            53   { "Network path not found. Server may be down or DNS not resolving." }
            67   { "Network name cannot be found. Check the share name." }
            85   { "Drive letter $drive is already in use. Run: net use $drive /delete /y" }
            86   { "Incorrect password." }
            1219 { "Multiple connections to same server with different credentials. Run: net use * /delete /y" }
            1326 { "Logon failure: unknown user name or bad password." }
            1396 { "Logon failure: domain trust relationship failure." }
            default { if ($winErrCode -gt 0) { "Windows error $winErrCode" } else { "net use exit code $LASTEXITCODE" } }
        }
        Write-Log "Failed to mount $label share [Windows error $winErrCode]: $errDetail" "ERROR"
        Write-Log "Raw output: $outputStr" "ERROR"
        exit 1
    }

    if (-not (Test-Path "${drive}\")) {
        Write-Log "Mounted $label share but ${drive}\ is not accessible. Check share-level permissions." "ERROR"
        exit 1
    }
    Write-Log "$label share mounted successfully to $drive"
}

function Unmount-Share([string]$drive, [string]$label) {
    $oldPref = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    net use $drive /delete /y 2>&1 | Out-Null
    $ErrorActionPreference = $oldPref
    Write-Log "Unmounted $label share [$drive]"
}

# =============================================================================
# MAIN
# =============================================================================

Write-Log "=== SMB Metadata Stamp Script ==="
Write-Log "Source:    $SourceUNC [user: $SourceUsername]"
Write-Log "Dest:      $DestUNC [user: $DestUsername]"
Write-Log "Log:       $LogFile"
Write-Log "Errors:    $ErrorFile"
if ($InputFile)  { Write-Log "InputFile:  $InputFile" }
if ($SidMapFile) { Write-Log "SidMapFile: $SidMapFile" }
Write-Log ""

Import-SidMap $SidMapFile

$r1 = Enable-Privilege "SeBackupPrivilege"
$r2 = Enable-Privilege "SeRestorePrivilege"
Write-Log "SeBackupPrivilege: $r1 | SeRestorePrivilege: $r2"
if ($r1 -ne "SUCCESS" -or $r2 -ne "SUCCESS") {
    Write-Log "Privilege elevation failed. Run as Administrator for full owner/ACL support." "WARN"
    Write-Log "Without these privileges, setting owner SID may fail on some files." "WARN"
}

$srcDrive = "S:"
$dstDrive = "T:"

Mount-Share $srcDrive $SourceUNC $SourceUsername $SourcePassword "source"
$srcMounted = $true
Mount-Share $dstDrive $DestUNC $DestUsername $DestPassword "destination"
$dstMounted = $true

$successCount = 0
$failCount    = 0
$skipCount    = 0
$startTime    = Get-Date

try {
    $filePairs = @()

    if ($InputFile) {
        Write-Log "Reading file pairs from $InputFile"
        try {
            $csv = Import-Csv $InputFile -ErrorAction Stop
        } catch {
            Write-Log "Failed to parse InputFile: $($_.Exception.Message)" "ERROR"; exit 1
        }
        if (-not $csv -or $csv.Count -eq 0) {
            Write-Log "InputFile is empty: $InputFile" "ERROR"; exit 1
        }

        $columns = $csv[0].PSObject.Properties.Name
        if ($columns -notcontains "Source Path") {
            Write-Log "InputFile must have a 'Source Path' column. Found: $($columns -join ', ')" "ERROR"; exit 1
        }

        $hasDestCol = $columns -contains "Destination Path"
        if ($hasDestCol) {
            Write-Log "CSV has 'Destination Path' column - using it for destination paths"
        } else {
            Write-Log "CSV has no 'Destination Path' column - mirroring source path to destination"
        }

        # Build the share prefix to strip from CSV paths, e.g. "srv\nfs_share\"
        # $SourceShare and $DestShare are already normalised to backslashes above.
        $srcSharePrefix = if ($SourceShare) { $SourceShare + '\' } else { '' }
        $dstSharePrefix = if ($DestShare)   { $DestShare   + '\' } else { '' }

        $lineNum = 1
        foreach ($row in $csv) {
            $lineNum++
            $srcRel = $row."Source Path"
            if ([string]::IsNullOrWhiteSpace($srcRel)) {
                Write-Log "Skipping empty 'Source Path' at CSV line $lineNum" "WARN"; continue
            }
            # Strip leading slashes, normalise to backslashes.
            $srcRel = ($srcRel.Trim() -replace '^[/\\]+', '') -replace '/', '\'
            # Strip the share prefix (e.g. "srv\nfs_share\") leaving only the
            # share-relative portion (e.g. "subdir\file.txt").
            if ($srcSharePrefix -and $srcRel.StartsWith($srcSharePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                $srcRel = $srcRel.Substring($srcSharePrefix.Length)
            } elseif ($srcSharePrefix) {
                Write-Log "WARN: 'Source Path' at CSV line $lineNum does not start with share prefix '$srcSharePrefix': $($row.'Source Path')" "WARN"
            }

            if ($hasDestCol) {
                $dstRel = $row."Destination Path"
                if ([string]::IsNullOrWhiteSpace($dstRel)) {
                    Write-Log "Skipping empty 'Destination Path' at CSV line $lineNum" "WARN"; continue
                }
                $dstRel = ($dstRel.Trim() -replace '^[/\\]+', '') -replace '/', '\'
                if ($dstSharePrefix -and $dstRel.StartsWith($dstSharePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                    $dstRel = $dstRel.Substring($dstSharePrefix.Length)
                } elseif ($dstSharePrefix) {
                    Write-Log "WARN: 'Destination Path' at CSV line $lineNum does not start with share prefix '$dstSharePrefix': $($row.'Destination Path')" "WARN"
                }
            } else {
                $dstRel = $srcRel
            }

            $filePairs += @{
                Src     = Join-Path $srcDrive $srcRel
                Dest    = Join-Path $dstDrive $dstRel
                SrcRel  = $srcRel
                CsvLine = $lineNum
            }
        }
        Write-Log "Loaded $($filePairs.Count) file pairs from CSV [$($lineNum - 1) rows]"
    } else {
        Write-Log "No InputFile - scanning source share for all files and directories..."
        $allItems = Get-ChildItem -LiteralPath "${srcDrive}\" -Recurse -Force -ErrorAction SilentlyContinue
        if (-not $allItems -or $allItems.Count -eq 0) {
            Write-Log "No items found on source share. Nothing to do." "WARN"; exit 0
        }
        foreach ($item in $allItems) {
            $rel = $item.FullName.Substring("${srcDrive}\".Length)
            $filePairs += @{
                Src     = $item.FullName
                Dest    = Join-Path $dstDrive $rel
                SrcRel  = $rel
                CsvLine = 0
            }
        }
        Write-Log "Found $($filePairs.Count) items to process"
    }

    Write-Log ""

    $dirs    = @($filePairs | Where-Object { Test-Path -LiteralPath $_.Src -PathType Container } | Sort-Object { $_.Src.Length })
    $files   = @($filePairs | Where-Object { Test-Path -LiteralPath $_.Src -PathType Leaf })
    $neither = @($filePairs | Where-Object {
        -not (Test-Path -LiteralPath $_.Src -PathType Container) -and
        -not (Test-Path -LiteralPath $_.Src -PathType Leaf) -and
        (Test-Path -LiteralPath $_.Src)
    })
    $totalItems = $dirs.Count + $files.Count + $neither.Count

    Write-Log "Processing $($dirs.Count) directories, $($files.Count) files [$totalItems total]"
    if ($neither.Count -gt 0) {
        Write-Log "$($neither.Count) items are neither file nor directory (symlinks, junctions, etc.)" "WARN"
    }
    Write-Log ""

    foreach ($pair in ($dirs + $files + $neither)) {
        $srcPath  = $pair.Src
        $destPath = $pair.Dest

        if (-not (Test-Path -LiteralPath $srcPath)) {
            $msg = "Source not found: $srcPath"
            if ($pair.CsvLine -gt 0) { $msg += " [CSV line $($pair.CsvLine)]" }
            Write-Log "SKIP: $msg" "WARN"
            Write-Error-Entry $srcPath $destPath "SKIP" "Source not found"
            $skipCount++; continue
        }

        if (-not (Test-Path -LiteralPath $destPath)) {
            $msg = "Dest not found: $destPath"
            if ($pair.CsvLine -gt 0) { $msg += " [CSV line $($pair.CsvLine)]" }
            Write-Log "SKIP: $msg" "WARN"
            Write-Error-Entry $srcPath $destPath "SKIP" "Destination not found"
            $skipCount++; continue
        }

        $srcIsDir  = Test-Path -LiteralPath $srcPath  -PathType Container
        $destIsDir = Test-Path -LiteralPath $destPath -PathType Container
        if ($srcIsDir -ne $destIsDir) {
            $srcType  = if ($srcIsDir)  { "directory" } else { "file" }
            $destType = if ($destIsDir) { "directory" } else { "file" }
            Write-Log "SKIP [type mismatch]: source=$srcType dest=$destType - $srcPath" "WARN"
            Write-Error-Entry $srcPath $destPath "SKIP" "Type mismatch: source=$srcType dest=$destType"
            $skipCount++; continue
        }

        if ($destPath.Length -ge 260) {
            Write-Log "WARN: Dest path length [$($destPath.Length)] may exceed MAX_PATH: $destPath" "WARN"
        }

        try {
            # 1. Read ACL + attributes from source as JSON
            $aclJson = Get-FileSecurityFast $srcPath

            # 2. Translate SIDs using the map loaded from -SidMapFile (no-op if not provided)
            $aclJson = Resolve-AclSids $aclJson

            # 3. Apply ACL + attributes to destination; collect unresolved SIDs
            $unresolvedSids = Set-FileSecurityFast $destPath $aclJson
            if ($unresolvedSids -and $unresolvedSids.Count -gt 0) {
                $sidList = $unresolvedSids -join ', '
                Write-Log "WARN: Unresolved SIDs stamped on $destPath [$sidList]" "WARN"
                Write-Error-Entry $srcPath $destPath "UNRESOLVED_SID" $sidList
            }

            # 4. Copy timestamps separately (not part of Get/Set-FileSecurityFast)
            try {
                Set-FileTimestamps $srcPath $destPath
            } catch {
                Write-Log "WARN: Could not set timestamps on $destPath : $($_.Exception.Message)" "WARN"
                Write-Error-Entry $srcPath $destPath "SET_TIMESTAMP" $_.Exception.Message
            }

            $successCount++
            Write-Log "OK: $srcPath -> $destPath"

            if ($successCount % 500 -eq 0) {
                $elapsed = (Get-Date) - $startTime
                $rate    = if ($elapsed.TotalSeconds -gt 0) { [math]::Round($successCount / $elapsed.TotalSeconds, 1) } else { 0 }
                $pct     = [math]::Round(($successCount + $failCount + $skipCount) / $totalItems * 100, 1)
                Write-Log "Progress: $successCount/$totalItems [$pct%] @ $rate/sec | failed=$failCount skipped=$skipCount"
            }
        } catch {
            $errMsg = $_.Exception.Message
            Write-Log "FAIL: $srcPath -> $destPath : $errMsg" "ERROR"
            Write-Error-Entry $srcPath $destPath "STAMP" $errMsg
            $failCount++
            $script:failedItems += [PSCustomObject]@{
                "Source Path" = $pair.SrcRel
                Error         = $errMsg
            }
        }
    }
} finally {
    $elapsed = (Get-Date) - $startTime
    $rate    = if ($elapsed.TotalSeconds -gt 0) { [math]::Round(($successCount + $failCount + $skipCount) / $elapsed.TotalSeconds, 1) } else { 0 }

    Write-Log ""
    Write-Log "==========================================="
    Write-Log "=== Summary ==="
    Write-Log "==========================================="
    Write-Log "Success:   $successCount"
    Write-Log "Failed:    $failCount"
    Write-Log "Skipped:   $skipCount"
    Write-Log "Total:     $($successCount + $failCount + $skipCount) / $totalItems"
    Write-Log "Rate:      $rate items/sec"
    Write-Log "Duration:  $([math]::Round($elapsed.TotalMinutes, 2)) min [$([math]::Round($elapsed.TotalSeconds, 1))s]"
    Write-Log "Log file:  $LogFile"
    Write-Log "Error file: $ErrorFile"
    Write-Log ""

    if ($failedItems.Count -gt 0) {
        $failedCsv = $LogFile -replace '\.log$', '-failures.csv'
        $failedItems | Export-Csv -Path $failedCsv -NoTypeInformation -Encoding UTF8
        Write-Log "Failed items CSV: $failedCsv" "WARN"
        Write-Log "Re-run with -InputFile '$failedCsv' to retry failed items" "WARN"
    }

    if ($srcMounted) { Unmount-Share $srcDrive "source" }
    if ($dstMounted) { Unmount-Share $dstDrive "destination" }
    Write-Log "Done"
}
