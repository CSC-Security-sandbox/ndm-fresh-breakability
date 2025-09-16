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
        uint SecurityInfo,
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

ffunction Get-FileSecurityFast([string]$path) {
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

    # Copy raw security descriptor bytes
    $sdLength = [MarshalHelpers]::GetSecurityDescriptorLength($pSD)
    $sdBytes = New-Object byte[] $sdLength
    [System.Runtime.InteropServices.Marshal]::Copy($pSD, $sdBytes, 0, $sdLength)
    $sd = New-Object System.Security.AccessControl.RawSecurityDescriptor($sdBytes, 0)

    $owner = $sd.Owner.Value
    $group = $sd.Group.Value

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

    # Get file attributes
    $attributes = [System.IO.File]::GetAttributes($path).ToString()

    $obj = [PSCustomObject]@{
        Owner      = $owner
        Group      = $group
        DaclAces   = $daclAces
        Attributes = $attributes
    }

    return ($obj | ConvertTo-Json -Compress)
}

function Set-FileSecurityFast([string]$path, [string]$aclJson) {
    $securityInfo = $aclJson | ConvertFrom-Json

    # Convert owner and group SIDs
    $ownerSid = New-Object System.Security.Principal.SecurityIdentifier($securityInfo.Owner)
    $groupSid = New-Object System.Security.Principal.SecurityIdentifier($securityInfo.Group)

    # Build a new RawSecurityDescriptor
    $sd = New-Object System.Security.AccessControl.RawSecurityDescriptor('O:BAG:BAD:')
    $sd.Owner = $ownerSid
    $sd.Group = $groupSid

    # Create DACL
    $aces = $securityInfo.DaclAces
    $dacl = New-Object System.Security.AccessControl.RawAcl(2, $aces.Count)
    foreach ($ace in $aces) {
        $sid = New-Object System.Security.Principal.SecurityIdentifier($ace.Sid)
        $qualifier = if ($ace.AceType -eq 0) {
            [System.Security.AccessControl.AceQualifier]::AccessAllowed
        } elseif ($ace.AceType -eq 1) {
            [System.Security.AccessControl.AceQualifier]::AccessDenied
        } else {
            throw "Unsupported ACE type: $($ace.AceType)"
        }
        $dacl.InsertAce($dacl.Count, (
            New-Object System.Security.AccessControl.CommonAce (
                [System.Security.AccessControl.AceFlags]$ace.AceFlags,
                $qualifier,
                [int]$ace.AccessMask,
                $sid,
                $ace.IsInherited,
                $null
            )
        ))
    }
    $sd.DiscretionaryAcl = $dacl

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
    $ALL_SECURITY_INFORMATION = 0x07

    $result = [FastAcl]::SetNamedSecurityInfo(
        $path,
        $SE_FILE_OBJECT,
        $ALL_SECURITY_INFORMATION,
        $ptrOwner,
        $ptrGroup,
        $ptrDacl,
        $ptrSacl
    )

    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrOwner)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrGroup)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrDacl)

    if ($result -ne 0) { throw "Error writing security info: $result" }

    # Set file attributes
    if ($securityInfo.Attributes) {
        $attrEnum = [System.Enum]::Parse([System.IO.FileAttributes], $securityInfo.Attributes)
        [System.IO.File]::SetAttributes($path, $attrEnum)
    }

    Write-Output '{"success":true}'
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