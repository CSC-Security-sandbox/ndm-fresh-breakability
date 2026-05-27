export const psBaseAclDefinition = `
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
"@

$SE_FILE_OBJECT = 1
$OWNER_SECURITY_INFORMATION = 0x00000001
$GROUP_SECURITY_INFORMATION = 0x00000002
$DACL_SECURITY_INFORMATION  = 0x00000004
$SACL_SECURITY_INFORMATION  = 0x00000008
$ALL_SECURITY_INFORMATION   = $OWNER_SECURITY_INFORMATION -bor $GROUP_SECURITY_INFORMATION -bor $DACL_SECURITY_INFORMATION 

function Get-FileSecurityFast([string]$path) {
    $getAclLogs = [System.Collections.Generic.List[string]]::new()
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $getAclLogs.Add("start path=$path")

    $pOwnerSid = [IntPtr]::Zero
    $pGroupSid = [IntPtr]::Zero
    $pDacl = [IntPtr]::Zero
    $pSacl = [IntPtr]::Zero
    $pSD = [IntPtr]::Zero

    $SE_FILE_OBJECT = 1
    $OWNER_SECURITY_INFORMATION = 0x00000001
    $GROUP_SECURITY_INFORMATION = 0x00000002
    $DACL_SECURITY_INFORMATION  = 0x00000004
    $ALL_SECURITY_INFORMATION   = $OWNER_SECURITY_INFORMATION -bor $GROUP_SECURITY_INFORMATION -bor $DACL_SECURITY_INFORMATION 

    try {
        $result = [FastAcl]::GetNamedSecurityInfo(
            $path,
            $SE_FILE_OBJECT,
            $ALL_SECURITY_INFORMATION,
            [ref]$pOwnerSid,
            [ref]$pGroupSid,
            [ref]$pDacl,
            [ref]$pSacl,
            [ref]$pSD
        )
    } catch {
        throw "Error reading security info: $_"
    }

    if ($result -ne 0) { throw "Error reading security info: $result" }
    $getAclLogs.Add("GetNamedSecurityInfo ok elapsed=$($sw.ElapsedMilliseconds)ms")

    $sdLength = [MarshalHelpers]::GetSecurityDescriptorLength($pSD)
    $sdBytes = New-Object byte[] $sdLength
    [System.Runtime.InteropServices.Marshal]::Copy($pSD, $sdBytes, 0, $sdLength)
    $sd = New-Object System.Security.AccessControl.RawSecurityDescriptor($sdBytes, 0)

    $owner = $sd.Owner.Value
    $group = $sd.Group.Value

    $attributes = [System.IO.File]::GetAttributes($path).ToString()

    # Check control flags for inheritance status
    $ctrl = $sd.ControlFlags
    
    # Check individual flags
    $daclPresent   = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclPresent) -ne 0
    $daclProtected = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -ne 0
    $daclAutoInherit = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherited) -ne 0

    # Three-state DaclAces representation, in lockstep with DaclPresent:
    #   DaclPresent=$false  → DaclAces=$null  (NULL DACL; ignore any
    #                          leftover DACL bytes the kernel keeps around
    #                          even when SE_DACL_PRESENT is cleared — they
    #                          are not enumerated during access checks, so
    #                          surfacing them here only produces a phantom
    #                          ACE that the gate and validator would chase
    #                          on every incremental scan).
    #   DaclPresent=$true   → DaclAces=@() if no ACEs (empty DACL = deny
    #                          all), or an array of ACE objects otherwise.
    # This matches Win32 semantics: SE_DACL_PRESENT alone decides whether
    # the object has a DACL at all; the array contents only matter when it
    # does.
    if ($daclPresent -and $sd.DiscretionaryAcl) {
        $daclAces = @()
        foreach ($ace in $sd.DiscretionaryAcl) {
            $daclAces += [PSCustomObject]@{
                Sid         = $ace.SecurityIdentifier.Value
                AccessMask  = $ace.AccessMask
                AceType     = [int]$ace.AceType
                AceFlags    = [int]$ace.AceFlags
                IsInherited = $ace.IsInherited
            }
        }
    } elseif ($daclPresent) {
        $daclAces = @()
    } else {
        $daclAces = $null
    }

    $aceCount = if ($null -eq $daclAces) { 'null' } else { $daclAces.Count }
    $getAclLogs.Add("parsed Owner=$owner Group=$group ControlFlags=$ctrl DaclPresent=$daclPresent DaclProtected=$daclProtected DaclAutoInherit=$daclAutoInherit DaclAceCount=$aceCount Attributes=$attributes elapsed=$($sw.ElapsedMilliseconds)ms")

    $log_json = '[' + ((@($getAclLogs) | ForEach-Object { $_ | ConvertTo-Json -Compress }) -join ',') + ']'

    [PSCustomObject]@{
        Owner         = $owner
        Group         = $group
        DaclAces      = $daclAces
        DaclPresent   = $daclPresent
        DaclProtected = $daclProtected
        DaclAutoInherit = $daclAutoInherit
        Attributes    = $attributes
        logs          = $getAclLogs
    } | ConvertTo-Json -Compress
}

function Set-FileSecurityFast([string]$path, [string]$aclJson) {
    # Operator-facing diagnostic trail. Each entry is a free-form string;
    # the wrapper script emits the list as a JSON "logs" array alongside
    # the existing success/error payload so the worker can forward each
    # line to its own logger. Script scope so the wrapper's catch block
    # can still surface whatever we accumulated before the throw.
    $script:setAclLogs = [System.Collections.Generic.List[string]]::new()
    $script:setAclLogs.Add("start path=$path aclJsonLen=$($aclJson.Length)")

    $securityInfo = $aclJson | ConvertFrom-Json
    $unresolved_sids = @()
    # Convert owner and group SIDs
    $ownerSid = New-Object System.Security.Principal.SecurityIdentifier($securityInfo.Owner)
    $groupSid = New-Object System.Security.Principal.SecurityIdentifier($securityInfo.Group)
    # DaclAces follows the three-state contract documented on the
    # SecurityDescriptor type: $null = NULL DACL (no DACL on disk), @() =
    # empty present DACL (deny all), array = populated DACL. Log all three
    # distinctly so the operator can tell which one we were asked to write.
    if ($null -eq $securityInfo.DaclAces) {
        $daclAcesShape = 'null'
        $aceCount = 0
    } else {
        $daclAcesShape = 'array'
        $aceCount = @($securityInfo.DaclAces).Count
    }
    $script:setAclLogs.Add("parsed Owner=$($securityInfo.Owner) Group=$($securityInfo.Group) DaclPresent=$($securityInfo.DaclPresent) DaclProtected=$($securityInfo.DaclProtected) DaclAutoInherit=$($securityInfo.DaclAutoInherit) DaclAces=$daclAcesShape DaclAceCount=$aceCount Attributes=$($securityInfo.Attributes)")

    # Build a new RawSecurityDescriptor with exact control flags
    $sd = New-Object System.Security.AccessControl.RawSecurityDescriptor('O:BAG:BAD:')
    $sd.Owner = $ownerSid
    $is_resolved = Map-Sid $ownerSid
    if ($is_resolved -eq $false) {
        $unresolved_sids += $ownerSid
    }
    $sd.Group = $groupSid
    $is_resolved = Map-Sid $groupSid
    if ($is_resolved -eq $false) {
        $unresolved_sids += $groupSid
    }

    # Honor source NULL DACL semantics (SE_DACL_PRESENT=0 on source means
    # "grant all access to all callers"). Without this branch we would
    # silently stamp an empty-but-present DACL on the destination, which
    # has the opposite meaning (deny-all). Strict equality on $false so
    # legacy JSON without the field defaults to "DACL present".
    $stampNullDacl = ($securityInfo.DaclPresent -eq $false)
    $script:setAclLogs.Add("stampNullDacl=$stampNullDacl")

    if (-not $stampNullDacl) {
        # Create DACL with exact ACEs from source in proper order.
        # $securityInfo.DaclAces may be $null even when DaclPresent=true
        # if the source happened to be an empty present DACL — treat as
        # zero ACEs so we still stamp SE_DACL_PRESENT=1 with AceCount=0
        # (the "deny all" state, distinct from NULL DACL).
        $aces = if ($null -eq $securityInfo.DaclAces) { @() } else { @($securityInfo.DaclAces) }
        $dacl = New-Object System.Security.AccessControl.RawAcl(2, $aces.Count)

        # Insert ACEs in exact order from source
        for ($i = 0; $i -lt $aces.Count; $i++) {
            $ace = $aces[$i]
            $sid = New-Object System.Security.Principal.SecurityIdentifier($ace.Sid)
            $is_resolved = Map-Sid $sid
            if ($is_resolved -eq $false) {
                $unresolved_sids += $sid
            }
            $qualifier = if ($ace.AceType -eq 0) {
                [System.Security.AccessControl.AceQualifier]::AccessAllowed
            } elseif ($ace.AceType -eq 1) {
                [System.Security.AccessControl.AceQualifier]::AccessDenied
            } else {
                throw "Unsupported ACE type: $($ace.AceType)"
            }

            # Create CommonAce with exact flags and properties from source.
            #
            # 5th arg is .NET's isCallback (NOT "IsInherited"). When true,
            # CommonAce promotes the on-disk ACE type from
            # AccessAllowed (0) / AccessDenied (1) to
            # AccessAllowedCallback (9) / AccessDeniedCallback (10) via
            # TypeFromQualifier(isCallback, qualifier). NDM never emits
            # callback ACEs (the reader and the validator filter
            # AceType not in {0, 1} everywhere), so this must stay $false.
            # The "inherited" semantic the source intends to carry is
            # already encoded in AceFlags bit 0x10 (INHERITED_ACE) and
            # round-trips through the AceFlags cast on the line above.
            $commonAce = New-Object System.Security.AccessControl.CommonAce (
                [System.Security.AccessControl.AceFlags]$ace.AceFlags,
                $qualifier,
                [int]$ace.AccessMask,
                $sid,
                $false,
                $null
            )

            # Insert at specific position to maintain order
            $dacl.InsertAce($i, $commonAce)
        }
        $sd.DiscretionaryAcl = $dacl
    }

    # Set control flags to match source exactly. SE_DACL_PROTECTED and
    # SE_DACL_AUTO_INHERITED are *per-DACL* flags (describe behaviour of
    # an existing DACL) — with no DACL there is nothing for either flag
    # to attach to or affect, so both are gated behind the present branch
    # alongside DiscretionaryAclPresent itself. Windows also clears these
    # bits whenever SE_DACL_PRESENT is cleared, so this mirrors the
    # reader's symmetric round-trip.
    $flags = [System.Security.AccessControl.ControlFlags]::SelfRelative
    if (-not $stampNullDacl) {
        $flags = $flags -bor [System.Security.AccessControl.ControlFlags]::DiscretionaryAclPresent
        if ($securityInfo.DaclProtected) {
            $flags = $flags -bor [System.Security.AccessControl.ControlFlags]::DiscretionaryAclProtected
        }
        if ($securityInfo.DaclAutoInherit) {
            $flags = $flags -bor [System.Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherit
        }
    }
    $sd.SetFlags($flags)
    $script:setAclLogs.Add("computed ControlFlags=$flags")

    # Marshal and set security
    $ownerBytes = New-Object byte[] ($sd.Owner.BinaryLength)
    $sd.Owner.GetBinaryForm($ownerBytes, 0)
    $ptrOwner = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($ownerBytes.Length)
    [System.Runtime.InteropServices.Marshal]::Copy($ownerBytes, 0, $ptrOwner, $ownerBytes.Length)

    $groupBytes = New-Object byte[] ($sd.Group.BinaryLength)
    $sd.Group.GetBinaryForm($groupBytes, 0)
    $ptrGroup = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($groupBytes.Length)
    [System.Runtime.InteropServices.Marshal]::Copy($groupBytes, 0, $ptrGroup, $groupBytes.Length)

    # Marshal the DACL only when we have one. For NULL DACL the Win32
    # contract is pDacl = IntPtr.Zero with DACL_SECURITY_INFORMATION still
    # set ("explicitly set DACL to NULL").
    if ($stampNullDacl) {
        $ptrDacl = [IntPtr]::Zero
    } else {
        $daclBytes = New-Object byte[] ($dacl.BinaryLength)
        $dacl.GetBinaryForm($daclBytes, 0)
        $ptrDacl = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($daclBytes.Length)
        [System.Runtime.InteropServices.Marshal]::Copy($daclBytes, 0, $ptrDacl, $daclBytes.Length)
    }

    $ptrSacl = [IntPtr]::Zero

    $SE_FILE_OBJECT = 1
    $OWNER_SECURITY_INFORMATION = 0x00000001
    $GROUP_SECURITY_INFORMATION = 0x00000002
    $DACL_SECURITY_INFORMATION  = 0x00000004
    $PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000
    $UNPROTECTED_DACL_SECURITY_INFORMATION = 0x20000000

    # DACL protection flags only apply to present DACLs. For NULL DACL,
    # leave both PROTECTED_/UNPROTECTED_ out — there is nothing to
    # protect/unprotect from inheritance.
    $securityInfoFlags = $OWNER_SECURITY_INFORMATION -bor $GROUP_SECURITY_INFORMATION -bor $DACL_SECURITY_INFORMATION
    if (-not $stampNullDacl) {
        if ($securityInfo.DaclProtected) {
            # Convert to signed int32 to handle the flag properly (matches working set.ps1)
            $securityInfoFlags = [int]($securityInfoFlags -bor $PROTECTED_DACL_SECURITY_INFORMATION)
        } else {
            $securityInfoFlags = [int]$securityInfoFlags -bor $UNPROTECTED_DACL_SECURITY_INFORMATION
        }
    }

    $script:setAclLogs.Add("calling SetNamedSecurityInfo securityInfoFlags=$securityInfoFlags (0x$($securityInfoFlags.ToString('X8'))) ptrDaclIsZero=$($ptrDacl -eq [IntPtr]::Zero) DaclProtected=$($securityInfo.DaclProtected)")
    $setSw = [System.Diagnostics.Stopwatch]::StartNew()
    $result = [FastAcl]::SetNamedSecurityInfo(
        $path,
        $SE_FILE_OBJECT,
        $securityInfoFlags,
        $ptrOwner,
        $ptrGroup,
        $ptrDacl,
        $ptrSacl
    )
    $setSw.Stop()
    $script:setAclLogs.Add("SetNamedSecurityInfo returned $result elapsed=$($setSw.ElapsedMilliseconds)ms")

    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrOwner)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrGroup)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrDacl)

    if ($result -ne 0) { throw "Error writing security info: $result" }

    # Set file attributes
    if ($securityInfo.Attributes) {
        $attrEnum = [System.Enum]::Parse([System.IO.FileAttributes], $securityInfo.Attributes)
        [System.IO.File]::SetAttributes($path, $attrEnum)
        $script:setAclLogs.Add("applied attributes=$($securityInfo.Attributes)")
    }
        
    $unresolved_sid_values = @()
    if ($unresolved_sids.Count -gt 0) {
        $unresolved_sid_values = @($unresolved_sids | ForEach-Object { $_.Value })
        # Manually build JSON array
        $json_array = '[' + (($unresolved_sid_values | ForEach-Object { '"' + $_ + '"' }) -join ',') + ']'
    } else {
        $json_array = '[]'
    }
    $script:setAclLogs.Add("done unresolvedSidCount=$($unresolved_sid_values.Count)")

    # Build the "logs" array by JSON-encoding each entry (handles embedded
    # quotes/backslashes correctly) and joining inside [ ... ]. Emit it
    # alongside the existing fields so downstream parsers (which already
    # JSON.parse the stdout for the unresolved_sids field) pick it up
    # without any contract change.
    $log_json = '[' + ((@($script:setAclLogs) | ForEach-Object { $_ | ConvertTo-Json -Compress }) -join ',') + ']'
    Write-Output ('{"success":true, "unresolved_sids":' + $json_array + ',"logs":' + $log_json + '}')
}

function Resolve-UsernamesToSid {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [string[]]$Usernames
    )

    function Try-Translate([string]$acct) {
        try {
            return ([System.Security.Principal.NTAccount]$acct).Translate([System.Security.Principal.SecurityIdentifier]).Value
        } catch {
            return $null
        }
    }

    $computer   = $env:COMPUTERNAME
    $userdomain = $env:USERDOMAIN
    $results    = New-Object System.Collections.Generic.List[object]

    foreach ($u in $Usernames) {
        if ([string]::IsNullOrWhiteSpace($u)) { continue }

        if ($u -match '^S-1-') {
            $results.Add([pscustomobject]@{ username = $u; sid = $u }) | Out-Null
            continue
        }

        $sid = $null

        # Qualified (DOMAIN\\name) or UPN -> try as-is
        if ($u -like '*\\*' -or $u -like '*@*') {
            $sid = Try-Translate $u
        }
        # Try local machine qualification
        if (-not $sid) {
            $sid = Try-Translate "$computer\\$u"
        }
        # Fallback: current USERDOMAIN
        if (-not $sid -and $userdomain) {
            $sid = Try-Translate "$userdomain\\$u"
        }

        if ($sid) {
            $results.Add([pscustomobject]@{ username = $u; sid = $sid }) | Out-Null
        } else {
            $results.Add([pscustomobject]@{ username = $u; sid = 'Invalid' }) | Out-Null
        }
    }

    $results | ConvertTo-Json -Compress
}
function Map-Sid {
    param($sid)

    try {
        $null = $sid.Translate([System.Security.Principal.NTAccount]).Value
        return $true
    } catch {
        return $false
    }
}
function SidToName {
    param(
        [string]$sidStr
    )
    try {
        $sidObj = New-Object System.Security.Principal.SecurityIdentifier($sidStr)
        return $sidObj.Translate([System.Security.Principal.NTAccount]).Value
    } catch {
        return $false
    }
}
function Get-NTFSLinkInfo {
    param([string]$path)

    try {
        $item = Get-Item -Path $path -Force -ErrorAction Stop

        $isReparsePoint = ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0

        if (-not $isReparsePoint) {
            return (@{
                IsLink = $false
                LinkType = "None"
                IsSymbolicLink = $false
                IsJunction = $false
                IsVolumeMountPoint = $false
                Target = $null
                IsDirectory = $item.PSIsContainer
            } | ConvertTo-Json -Compress)
        }

        # Get target path if available
        $target = $null
        if ($item.PSObject.Properties['Target'] -and $item.Target) {
            $target = $item.Target
        }

        # Get LinkType (usually "Junction" or "SymbolicLink")
        $linkType = if ($item.PSObject.Properties['LinkType'] -and $item.LinkType) { 
            $item.LinkType 
        } else { 
            "Unknown" 
        }

        # Initialize flags
        $isVolumeMountPoint = $false
        $isJunction = $false
        $isSymbolicLink = $false

        if ($linkType -eq "SymbolicLink") {
            $isSymbolicLink = $true
        }
        elseif ($linkType -eq "Junction") {
            $pattern = 'Volume\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}'
            if ($target -and ($target -match  $pattern)) {
                $isVolumeMountPoint = $true
            } else {
                $isJunction = $true
            }
        }

        return (@{
            IsLink = $true
            LinkType = if ($isVolumeMountPoint) { "VolumeMountPoint" } else { $linkType }
            IsSymbolicLink = $isSymbolicLink
            IsJunction = $isJunction
            IsVolumeMountPoint = $isVolumeMountPoint
            Target = $target
            IsDirectory = $item.PSIsContainer
        } | ConvertTo-Json -Compress)

    } catch {
        return (@{ error = $_.Exception.Message } | ConvertTo-Json -Compress)
    }
}
`

export const psGetAclScript = `
try {
    if (!(Test-Path $srcFile)) { throw "File not found: $srcFile" }
    Get-FileSecurityFast $srcFile
} catch {
    Write-Output "ERROR: $($_.Exception.Message)"
}
`;

export const psSetAclScript = `
try {
    if (!(Test-Path $dstFile)) { throw "File not found: $dstFile" }
    Set-FileSecurityFast $dstFile $aclJson
} catch {
    # Preserve whatever Set-FileSecurityFast accumulated before the throw —
    # the operator's only window into how far we got. $script:setAclLogs is
    # initialized at the top of Set-FileSecurityFast so it will exist if
    # the function was entered, and be $null only for pre-call failures
    # (e.g. Test-Path threw above).
    $logsField = ''
    if ($script:setAclLogs -and $script:setAclLogs.Count -gt 0) {
        $log_json = '[' + ((@($script:setAclLogs) | ForEach-Object { $_ | ConvertTo-Json -Compress }) -join ',') + ']'
        $logsField = ',"logs":' + $log_json
    }
    Write-Output ('{"error":' + (($_.Exception.Message | ConvertTo-Json -Compress)) + $logsField + '}')
}
`;

export const psGetLinkInfoScript = `
try {
    Get-NTFSLinkInfo $srcFile
} catch {
    Write-Output (@{ error = $_.Exception.Message } | ConvertTo-Json -Compress)
}
`;

export const psEnableBackupPrivilegeScriptMinified = `using System;using System.Runtime.InteropServices;using System.ComponentModel;
public class TokenManipulator{
[DllImport("advapi32.dll",SetLastError=true)]static extern bool AdjustTokenPrivileges(IntPtr h,bool d,ref P n,int l,IntPtr p,IntPtr r);
[DllImport("advapi32.dll",SetLastError=true)]static extern bool OpenProcessToken(IntPtr h,int a,ref IntPtr t);
[DllImport("advapi32.dll",SetLastError=true,CharSet=CharSet.Unicode)]static extern bool LookupPrivilegeValue(string h,string n,ref long l);
[DllImport("kernel32.dll",SetLastError=true)]static extern bool CloseHandle(IntPtr h);
[StructLayout(LayoutKind.Sequential,Pack=1)]struct P{public int C;public long L;public int A;}
const int E=2,Q=8,J=32;
public static string EnablePrivilegeForPid(int pid,string priv){
IntPtr t=IntPtr.Zero;
try{
var p=System.Diagnostics.Process.GetProcessById(pid);
if(!OpenProcessToken(p.Handle,J|Q,ref t))return "FAILED:"+new Win32Exception(Marshal.GetLastWin32Error()).Message;
long l=0;
if(!LookupPrivilegeValue(null,priv,ref l))return "FAILED:"+priv;
P tp=new P();tp.C=1;tp.L=l;tp.A=E;
if(!AdjustTokenPrivileges(t,false,ref tp,0,IntPtr.Zero,IntPtr.Zero))return "FAILED:ATP";
return Marshal.GetLastWin32Error()==1300?"FAILED:NotAssigned":"SUCCESS";
}catch(Exception ex){return "FAILED:"+ex.Message;}
finally{if(t!=IntPtr.Zero)CloseHandle(t);}
}}`;

export const psEnableBackupPrivilegeScript = `
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

    internal const int SE_PRIVILEGE_ENABLED = 0x00000002;
    internal const int TOKEN_QUERY = 0x00000008;
    internal const int TOKEN_ADJUST_PRIVILEGES = 0x00000020;

    // For PowerShell shells: Enable privilege in current process
    public static string EnablePrivilege(string privilegeName) {
        IntPtr hToken = IntPtr.Zero;
        try {
            IntPtr hProc = GetCurrentProcess();
            
            if (!OpenProcessToken(hProc, TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, ref hToken)) {
                return "FAILED: OpenProcessToken - " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
            }
            
            long luid = 0;
            if (!LookupPrivilegeValue(null, privilegeName, ref luid)) {
                return "FAILED: LookupPrivilegeValue for " + privilegeName + " - " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
            }
            
            TokPriv1Luid tp = new TokPriv1Luid();
            tp.Count = 1;
            tp.Luid = luid;
            tp.Attr = SE_PRIVILEGE_ENABLED;
            
            if (!AdjustTokenPrivileges(hToken, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero)) {
                return "FAILED: AdjustTokenPrivileges - " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
            }
            
            int lastError = Marshal.GetLastWin32Error();
            if (lastError == 1300) {
                return "FAILED: Privilege not assigned to user";
            }
            
            return "SUCCESS";
        } catch (Exception ex) {
            return "FAILED: " + ex.Message;
        } finally {
            if (hToken != IntPtr.Zero) {
                CloseHandle(hToken);
            }
        }
    }

    // For Node.js main process: Enable privilege in specific process by PID
    public static string EnablePrivilegeForPid(int processId, string privilegeName) {
        IntPtr hToken = IntPtr.Zero;
        try {
            var proc = System.Diagnostics.Process.GetProcessById(processId);
            IntPtr hProc = proc.Handle;
            
            if (!OpenProcessToken(hProc, TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, ref hToken)) {
                return "FAILED: OpenProcessToken - " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
            }
            
            long luid = 0;
            if (!LookupPrivilegeValue(null, privilegeName, ref luid)) {
                return "FAILED: LookupPrivilegeValue for " + privilegeName + " - " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
            }
            
            TokPriv1Luid tp = new TokPriv1Luid();
            tp.Count = 1;
            tp.Luid = luid;
            tp.Attr = SE_PRIVILEGE_ENABLED;
            
            if (!AdjustTokenPrivileges(hToken, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero)) {
                return "FAILED: AdjustTokenPrivileges - " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
            }
            
            int lastError = Marshal.GetLastWin32Error();
            if (lastError == 1300) {
                return "FAILED: Privilege not assigned to user";
            }
            
            return "SUCCESS";
        } catch (Exception ex) {
            return "FAILED: " + ex.Message;
        } finally {
            if (hToken != IntPtr.Zero) {
                CloseHandle(hToken);
            }
        }
    }
}
`;
