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

public class LocalMem {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr LocalFree(IntPtr hMem);
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

    try {
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

        $ctrl = $sd.Control
        $daclPresent     = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclPresent) -ne 0
        $daclProtected   = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -ne 0
        $daclAutoInherit = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherited) -ne 0

        [PSCustomObject]@{
            Owner           = $owner
            Group           = $group
            DaclAces        = $daclAces
            DaclPresent     = $daclPresent
            DaclProtected   = $daclProtected
            DaclAutoInherit = $daclAutoInherit
            Attributes      = $attributes
        } | ConvertTo-Json -Compress
    }
    finally {
        if ($pSD -ne [IntPtr]::Zero) {
            [LocalMem]::LocalFree($pSD) | Out-Null
        }
    }
}

function Set-FileSecurityFast([string]$path, [string]$aclJson) {
    $securityInfo = $aclJson | ConvertFrom-Json
    $unresolved_sids = @()

    $ownerSid = New-Object System.Security.Principal.SecurityIdentifier($securityInfo.Owner)
    if (-not (Map-Sid $ownerSid)) { $unresolved_sids += $ownerSid }

    $groupSid = New-Object System.Security.Principal.SecurityIdentifier($securityInfo.Group)
    if (-not (Map-Sid $groupSid)) { $unresolved_sids += $groupSid }

    $allAces = $securityInfo.DaclAces
    if (-not $allAces) { $allAces = @() }

    # Include all ACEs - both explicit and inherited
    # Windows will handle inheritance propagation automatically
    $acesSource = $allAces

    $dacl = New-Object System.Security.AccessControl.RawAcl(2, ($acesSource.Count))
    for ($i = 0; $i -lt $acesSource.Count; $i++) {
        $ace = $acesSource[$i]
        $sid = New-Object System.Security.Principal.SecurityIdentifier($ace.Sid)
        if (-not (Map-Sid $sid)) { $unresolved_sids += $sid }

        $qualifier = switch ($ace.AceType) {
            0 { [System.Security.AccessControl.AceQualifier]::AccessAllowed }
            1 { [System.Security.AccessControl.AceQualifier]::AccessDenied }
            default { throw "Unsupported ACE type: $($ace.AceType)" }
        }

        $aceFlagsOriginal = [System.Security.AccessControl.AceFlags]$ace.AceFlags
        # Preserve inheritance flags to maintain proper inheritance behavior
        $aceFlags = $aceFlagsOriginal

        $commonAce = New-Object System.Security.AccessControl.CommonAce (
            $aceFlags,
            $qualifier,
            [int]$ace.AccessMask,
            $sid,
            $false,
            $null
        )
        $dacl.InsertAce($i, $commonAce)
    }

    $sd = New-Object System.Security.AccessControl.RawSecurityDescriptor('O:BAG:BAD:')
    $sd.Owner = $ownerSid
    $sd.Group = $groupSid
    $sd.DiscretionaryAcl = $dacl

    # Set control flags to properly handle inheritance
    $flags = [System.Security.AccessControl.ControlFlags]::SelfRelative -bor [System.Security.AccessControl.ControlFlags]::DiscretionaryAclPresent
    
    if ($securityInfo.DaclProtected) {
        $flags = $flags -bor [System.Security.AccessControl.ControlFlags]::DiscretionaryAclProtected
    } else {
        # Enable automatic inheritance when not protected
        if ($securityInfo.DaclAutoInherit) {
            $flags = $flags -bor [System.Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherited
        }
    }
    $sd.SetFlags($flags)

    $ownerBytes = New-Object byte[] ($sd.Owner.BinaryLength); $sd.Owner.GetBinaryForm($ownerBytes,0)
    $ptrOwner = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($ownerBytes.Length)
    [System.Runtime.InteropServices.Marshal]::Copy($ownerBytes,0,$ptrOwner,$ownerBytes.Length)

    $groupBytes = New-Object byte[] ($sd.Group.BinaryLength); $sd.Group.GetBinaryForm($groupBytes,0)
    $ptrGroup = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($groupBytes.Length)
    [System.Runtime.InteropServices.Marshal]::Copy($groupBytes,0,$ptrGroup,$groupBytes.Length)

    $daclBytes = New-Object byte[] ($dacl.BinaryLength); $dacl.GetBinaryForm($daclBytes,0)
    $ptrDacl = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($daclBytes.Length)
    [System.Runtime.InteropServices.Marshal]::Copy($daclBytes,0,$ptrDacl,$daclBytes.Length)

    $SE_FILE_OBJECT = 1
    $OWNER_SECURITY_INFORMATION = 0x00000001
    $GROUP_SECURITY_INFORMATION = 0x00000002
    $DACL_SECURITY_INFORMATION  = 0x00000004
    $PROTECTED_DACL_SECURITY_INFORMATION   = 0x80000000
    $UNPROTECTED_DACL_SECURITY_INFORMATION = 0x20000000

    $securityInfoFlags = $OWNER_SECURITY_INFORMATION -bor $GROUP_SECURITY_INFORMATION -bor $DACL_SECURITY_INFORMATION
    if ($securityInfo.DaclProtected) {
        $securityInfoFlags = [int]($securityInfoFlags -bor $PROTECTED_DACL_SECURITY_INFORMATION)
    } else {
        $securityInfoFlags = [int]($securityInfoFlags -bor $UNPROTECTED_DACL_SECURITY_INFORMATION)
        # Enable automatic inheritance for child objects
        if ($securityInfo.DaclAutoInherit) {
            $securityInfoFlags = [int]($securityInfoFlags -bor 0x10000000)  # DACL_AUTO_INHERIT_REQ
        }
    }

    $result = [FastAcl]::SetNamedSecurityInfo(
        $path,
        $SE_FILE_OBJECT,
        $securityInfoFlags,
        $ptrOwner,
        $ptrGroup,
        $ptrDacl,
        [IntPtr]::Zero
    )

    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrOwner)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrGroup)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrDacl)

    if ($result -ne 0) { throw "Error writing security info: $result" }

    if ($securityInfo.Attributes) {
        $attrEnum = [System.Enum]::Parse([System.IO.FileAttributes], $securityInfo.Attributes)
        [System.IO.File]::SetAttributes($path, $attrEnum)
    }

    $unresolved_sid_values = @()
    if ($unresolved_sids.Count -gt 0) {
        $unresolved_sid_values = @($unresolved_sids | Select-Object -Unique | ForEach-Object { $_.Value })
        $json_array = '[' + (($unresolved_sid_values | ForEach-Object { '"' + $_ + '"' }) -join ',') + ']'
        Write-Output ('{"success":true, "unresolved_sids":' + $json_array + '}')
    } else {
        Write-Output '{"success":true, "unresolved_sids":[]}'
    }
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
        if ($u -like '*\\*' -or $u -like '*@*') {
            $sid = Try-Translate $u
        }
        if (-not $sid) {
            $sid = Try-Translate "$computer\\$u"
        }
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
    param([string]$sidStr)
    try {
        $sidObj = New-Object System.Security.Principal.SecurityIdentifier($sidStr)
        return $sidObj.Translate([System.Security.Principal.NTAccount]).Value
    } catch {
        return $false
    }
}
`

export const psGetAclScript = `
try {
    if (!(Test-Path $srcFile)) { throw "File not found: $srcFile" }
    Get-FileSecurityFast $srcFile
} catch {
    Write-Output (@{ error = $_.Exception.Message } | ConvertTo-Json -Compress)
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
