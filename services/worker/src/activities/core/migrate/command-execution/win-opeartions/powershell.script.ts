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

    $sdLength = [MarshalHelpers]::GetSecurityDescriptorLength($pSD)
    $sdBytes = New-Object byte[] $sdLength
    [System.Runtime.InteropServices.Marshal]::Copy($pSD, $sdBytes, 0, $sdLength)
    $sd = New-Object System.Security.AccessControl.RawSecurityDescriptor($sdBytes, 0)

    $owner = $sd.Owner.Value
    $group = $sd.Group.Value

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

    $attributes = [System.IO.File]::GetAttributes($path).ToString()

    # Check control flags for inheritance status
    $ctrl = $sd.Control
    
    # Check individual flags
    $daclPresent   = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclPresent) -ne 0
    $daclProtected = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -ne 0
    $daclAutoInherit = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherited) -ne 0
    
    # If we have DACL ACEs but daclPresent is false, there might be a flag detection issue
    # Force daclPresent to true if we actually have ACEs
    if ($sd.DiscretionaryAcl -and $sd.DiscretionaryAcl.Count -gt 0) {
        $daclPresent = $true
    }
    
    # Additional check: if file has inheritance disabled, daclProtected should be true
    # This handles cases where Windows doesn't set the flag correctly
    $hasInheritedAces = $false
    if ($sd.DiscretionaryAcl) {
        foreach ($ace in $sd.DiscretionaryAcl) {
            if ($ace.IsInherited) {
                $hasInheritedAces = $true
                break
            }
        }
    }
    
    # If no inherited ACEs are present and we have explicit ACEs, inheritance is likely disabled (protected)
    if (-not $hasInheritedAces -and $daclPresent -and $sd.DiscretionaryAcl -and $sd.DiscretionaryAcl.Count -gt 0) {
        $daclProtected = $true
    }

    # Optional: free the security descriptor allocated by GetNamedSecurityInfo
    # [System.Runtime.InteropServices.Marshal]::FreeHGlobal($pSD) # can't use FreeHGlobal; should call LocalFree. Skipping to avoid crash.

    [PSCustomObject]@{
        Owner         = $owner
        Group         = $group
        DaclAces      = $daclAces
        DaclPresent   = $daclPresent
        DaclProtected = $daclProtected
        DaclAutoInherit = $daclAutoInherit
        Attributes    = $attributes
    } | ConvertTo-Json -Compress
}

function Set-FileSecurityFast([string]$path, [string]$aclJson) {
    $securityInfo = $aclJson | ConvertFrom-Json
    $unresolved_sids = @()
    # Convert owner and group SIDs
    $ownerSid = New-Object System.Security.Principal.SecurityIdentifier($securityInfo.Owner)
    $groupSid = New-Object System.Security.Principal.SecurityIdentifier($securityInfo.Group)

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

    # Create DACL with exact ACEs from source in proper order
    $aces = $securityInfo.DaclAces
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
        
        # Create CommonAce with exact flags and properties from source
        $commonAce = New-Object System.Security.AccessControl.CommonAce (
            [System.Security.AccessControl.AceFlags]$ace.AceFlags,
            $qualifier,
            [int]$ace.AccessMask,
            $sid,
            $ace.IsInherited,
            $null
        )
        
        # Insert at specific position to maintain order
        $dacl.InsertAce($i, $commonAce)
    }
    $sd.DiscretionaryAcl = $dacl
    
    # Set control flags to match source exactly
    $flags = [System.Security.AccessControl.ControlFlags]::DiscretionaryAclPresent -bor [System.Security.AccessControl.ControlFlags]::SelfRelative
    if ($securityInfo.DaclProtected) {
        $flags = $flags -bor [System.Security.AccessControl.ControlFlags]::DiscretionaryAclProtected
    }
    if ($securityInfo.DaclAutoInherit) {
        $flags = $flags -bor [System.Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherit
    }
    $sd.SetFlags($flags)

    # Marshal and set security
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

    $ptrSacl = [IntPtr]::Zero

    $SE_FILE_OBJECT = 1
    $OWNER_SECURITY_INFORMATION = 0x00000001
    $GROUP_SECURITY_INFORMATION = 0x00000002
    $DACL_SECURITY_INFORMATION  = 0x00000004
    $PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000
    $UNPROTECTED_DACL_SECURITY_INFORMATION = 0x20000000

    # Include protection flag to always disable inheritance
    $securityInfoFlags = $OWNER_SECURITY_INFORMATION -bor $GROUP_SECURITY_INFORMATION -bor $DACL_SECURITY_INFORMATION
    if ($securityInfo.DaclProtected) {
        # Convert to signed int32 to handle the flag properly (matches working set.ps1)
        $securityInfoFlags = [int]($securityInfoFlags -bor $PROTECTED_DACL_SECURITY_INFORMATION)
    } else {
        $securityInfoFlags = [int]$securityInfoFlags -bor $UNPROTECTED_DACL_SECURITY_INFORMATION
    }

    $result = [FastAcl]::SetNamedSecurityInfo(
        $path,
        $SE_FILE_OBJECT,
        $securityInfoFlags,
        $ptrOwner,
        $ptrGroup,
        $ptrDacl,
        $ptrSacl
    )

    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrOwner)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrGroup)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrDacl)

    # Build unresolved_sids JSON once — emitted on both success and failure paths
    $unresolved_json = '[' + ((@($unresolved_sids | ForEach-Object { '"' + $_.Value + '"' })) -join ',') + ']'

    if ($result -ne 0) {
        Write-Output ('{"success":false,"error":"Error writing security info: ' + $result + '","unresolved_sids":' + $unresolved_json + '}')
        return
    }

    if ($securityInfo.Attributes) {
        $attrEnum = [System.Enum]::Parse([System.IO.FileAttributes], $securityInfo.Attributes)
        [System.IO.File]::SetAttributes($path, $attrEnum)
    }

    Write-Output ('{"success":true,"unresolved_sids":' + $unresolved_json + '}')
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
    Write-Output ('{"error":' + (($_.Exception.Message | ConvertTo-Json -Compress)) + '}')
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
