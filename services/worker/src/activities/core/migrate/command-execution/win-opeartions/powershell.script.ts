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

function Get-FileSecurityFast([string]$path) {
    $pOwnerSid = [IntPtr]::Zero
    $pGroupSid = [IntPtr]::Zero
    $pDacl = [IntPtr]::Zero
    $pSacl = [IntPtr]::Zero
    $pSD = [IntPtr]::Zero

    $ALL_SECURITY_INFORMATION = $OWNER_SECURITY_INFORMATION -bor $GROUP_SECURITY_INFORMATION -bor $DACL_SECURITY_INFORMATION

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
    if ($result -ne 0) { throw "Error reading security info: $result" }

    $sdLength = [MarshalHelpers]::GetSecurityDescriptorLength($pSD)
    $sdBytes = New-Object byte[] $sdLength
    [System.Runtime.InteropServices.Marshal]::Copy($pSD, $sdBytes, 0, $sdLength)
    $sd = New-Object System.Security.AccessControl.RawSecurityDescriptor($sdBytes, 0)

    $owner = $sd.Owner.Value
    $group = $sd.Group.Value

    $explicitAces  = @()
    $inheritedAces = @()
    $flatAces      = @()  # Backward-compatible combined list

    if ($sd.DiscretionaryAcl) {
        foreach ($ace in $sd.DiscretionaryAcl) {
            $aceObj = [PSCustomObject]@{
                Sid         = $ace.SecurityIdentifier.Value
                AccessMask  = $ace.AccessMask
                AceType     = [int]$ace.AceType
                AceFlags    = [int]$ace.AceFlags
                IsInherited = $ace.IsInherited
            }
            $flatAces += $aceObj
            if ($ace.IsInherited) {
                $inheritedAces += $aceObj
            } else {
                $explicitAces += $aceObj
            }
        }
    }

    $ctrl = $sd.Control
    $daclPresent     = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclPresent) -ne 0
    $daclProtected   = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -ne 0
    $daclAutoInherit = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherited) -ne 0

    [PSCustomObject]@{
        Owner           = $owner
        Group           = $group
        # New structured fields
        ExplicitAces    = $explicitAces
        InheritedAces   = $inheritedAces
        # Legacy combined list (kept for existing consumers)
        DaclAces        = $flatAces
        DaclPresent     = $daclPresent
        DaclProtected   = $daclProtected
        DaclAutoInherit = $daclAutoInherit
        Attributes      = [System.IO.File]::GetAttributes($path).ToString()
    } | ConvertTo-Json -Compress
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
    $results = New-Object System.Collections.Generic.List[object]
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

function Set-FileSecurityFast([string]$path, [string]$aclJson) {
    $securityInfo = $aclJson | ConvertFrom-Json
    $unresolved_sids = @()

    $ownerSid = New-Object System.Security.Principal.SecurityIdentifier($securityInfo.Owner)
    if (-not (Map-Sid $ownerSid)) { $unresolved_sids += $ownerSid }
    $groupSid = New-Object System.Security.Principal.SecurityIdentifier($securityInfo.Group)
    if (-not (Map-Sid $groupSid)) { $unresolved_sids += $groupSid }

    $sd = New-Object System.Security.AccessControl.RawSecurityDescriptor('O:BAG:BAD:')
    $sd.Owner = $ownerSid
    $sd.Group = $groupSid

    $useProtected = $securityInfo.DaclProtected -eq $true

    # Backward compatibility:
    # If ExplicitAces missing but DaclAces present, synthesize.
    if (-not $securityInfo.PSObject.Properties.Match('ExplicitAces').Count -and $securityInfo.PSObject.Properties.Match('DaclAces').Count) {
        $securityInfo | Add-Member -NotePropertyName ExplicitAces -NotePropertyValue (@($securityInfo.DaclAces | Where-Object { -not $_.IsInherited })) -Force
        $securityInfo | Add-Member -NotePropertyName InheritedAces -NotePropertyValue (@($securityInfo.DaclAces | Where-Object { $_.IsInherited })) -Force
    }

    if ($useProtected) {
        $aceSource = @($securityInfo.ExplicitAces + $securityInfo.InheritedAces)
    } else {
        $aceSource = @($securityInfo.ExplicitAces)
    }

    $dacl = New-Object System.Security.AccessControl.RawAcl(2, $aceSource.Count)

    for ($i = 0; $i -lt $aceSource.Count; $i++) {
        $ace = $aceSource[$i]
        $sid = New-Object System.Security.Principal.SecurityIdentifier($ace.Sid)
        if (-not (Map-Sid $sid)) { $unresolved_sids += $sid }

        switch ($ace.AceType) {
            0 { $qualifier = [System.Security.AccessControl.AceQualifier]::AccessAllowed }
            1 { $qualifier = [System.Security.AccessControl.AceQualifier]::AccessDenied }
            default { throw "Unsupported ACE type: $($ace.AceType)" }
        }

        $origFlags = [System.Security.AccessControl.AceFlags]$ace.AceFlags
        if ($useProtected) {
            $finalFlags = $origFlags
        } else {
            # Strip inherited bit so Windows can generate real inherited ACEs.
            $finalFlags = $origFlags -band -bnot [System.Security.AccessControl.AceFlags]::Inherited
        }

        $commonAce = New-Object System.Security.AccessControl.CommonAce(
            $finalFlags,
            $qualifier,
            [int]$ace.AccessMask,
            $sid,
            $false,
            $null
        )
        $dacl.InsertAce($i, $commonAce)
    }

    $sd.DiscretionaryAcl = $dacl

    $flags = [System.Security.AccessControl.ControlFlags]::SelfRelative -bor [System.Security.AccessControl.ControlFlags]::DiscretionaryAclPresent
    
    if ($useProtected) {
        $flags = $flags -bor [System.Security.AccessControl.ControlFlags]::DiscretionaryAclProtected
    }
    $sd.SetFlags($flags)

    function ToPtr($sidObj) {
        $bytes = New-Object byte[] ($sidObj.BinaryLength)
        $sidObj.GetBinaryForm($bytes, 0)
        $ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
        [System.Runtime.InteropServices.Marshal]::Copy($bytes,0,$ptr,$bytes.Length)
        return $ptr
    }

    $ptrOwner = ToPtr $sd.Owner
    $ptrGroup = ToPtr $sd.Group
    $daclBytes = New-Object byte[] ($dacl.BinaryLength)
    $dacl.GetBinaryForm($daclBytes,0)
    $ptrDacl = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($daclBytes.Length)
    [System.Runtime.InteropServices.Marshal]::Copy($daclBytes,0,$ptrDacl,$daclBytes.Length)

    $OWNER = 0x1; $GROUP = 0x2; $DACL = 0x4
    $PROTECTED   = 0x80000000
    $UNPROTECTED = 0x20000000

    $securityInfoFlags = $OWNER -bor $GROUP -bor $DACL
    if ($useProtected) {
        $securityInfoFlags = [int]($securityInfoFlags -bor $PROTECTED)
    } else {
        $securityInfoFlags = [int]($securityInfoFlags -bor $UNPROTECTED)
    }

    $res = [FastAcl]::SetNamedSecurityInfo(
        $path,
        1,
        $securityInfoFlags,
        $ptrOwner,
        $ptrGroup,
        $ptrDacl,
        [IntPtr]::Zero
    )

    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrOwner)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrGroup)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrDacl)

    if ($res -ne 0) { throw "Error writing security info: $res" }

    # Optional: Force rebuild of inherited ACEs (uncomment if needed)
    # if (-not $useProtected) {
    #     [FastAcl]::SetNamedSecurityInfo(
    #         $path,
    #         1,
    #         [int]($DACL -bor $UNPROTECTED),
    #         [IntPtr]::Zero,
    #         [IntPtr]::Zero,
    #         [IntPtr]::Zero,
    #         [IntPtr]::Zero
    #     ) | Out-Null
    # }

    if ($securityInfo.Attributes) {
        $attrEnum = [System.Enum]::Parse([System.IO.FileAttributes], $securityInfo.Attributes)
        [System.IO.File]::SetAttributes($path, $attrEnum)
    }

    $unresolved_vals = @()
    if ($unresolved_sids.Count -gt 0) {
        $unresolved_vals = $unresolved_sids | Select-Object -Unique | ForEach-Object { $_.Value }
    }
    @{ success = $true; unresolved_sids = $unresolved_vals } | ConvertTo-Json -Compress
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