const base = `
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
    $owner = $sd.Owner.Value   # SID string, not NTAccount name!
    $group = $sd.Group.Value   # SID string, not NTAccount name!
    $daclAces = @()
    foreach ($ace in $sd.DiscretionaryAcl) {
        $sid = $ace.SecurityIdentifier.Value
        $accessMask = $ace.AccessMask
        $aceType = [int]$ace.AceType
        $aceFlags = [int]$ace.AceFlags
        $isInherited = $ace.IsInherited
        $daclAces += [PSCustomObject]@{
            Sid = $sid
            AccessMask = $accessMask
            AceType = $aceType
            AceFlags = $aceFlags
            IsInherited = $isInherited
        }
    }
    $obj = [PSCustomObject]@{
        Owner = $owner
        Group = $group
        DaclAces = $daclAces
    }
    $obj | ConvertTo-Json -Compress
}

function Set-FileSecurityFast([string]$path, [string]$aclJson) {
    $securityInfo = $aclJson | ConvertFrom-Json

    # Convert owner and group SIDs
    $ownerSid = New-Object System.Security.Principal.SecurityIdentifier($securityInfo.Owner)
    $groupSid = New-Object System.Security.Principal.SecurityIdentifier($securityInfo.Group)

    # Build a new RawSecurityDescriptor (empty DACL for now)
    $sd = New-Object System.Security.AccessControl.RawSecurityDescriptor('O:BAG:BAD:')
    $sd.Owner = $ownerSid
    $sd.Group = $groupSid

    # Create DACL
    $aces = $securityInfo.DaclAces
    $dacl = New-Object System.Security.AccessControl.RawAcl(2, $aces.Count)
    foreach ($ace in $aces) {
        $sid = New-Object System.Security.Principal.SecurityIdentifier($ace.Sid)
        $aceType = [System.Security.AccessControl.AceType]$ace.AceType
        $qualifier = if ($aceType -eq 'AccessAllowed') {
            [System.Security.AccessControl.AceQualifier]::AccessAllowed
        } elseif ($aceType -eq 'AccessDenied') {
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
    if ($ptrSacl -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrSacl) }
    if ($result -ne 0) { throw "Error writing security info: $result" }
    Write-Output '{"success":true}'
}
`

const psGetAclScript = `
try {
    if (!(Test-Path $srcFile)) { throw "File not found: $srcFile" }
    Get-FileSecurityFast $srcFile
} catch {
    Write-Output (@{ error = $_.Exception.Message } | ConvertTo-Json -Compress)
}
`;

const psSetAclScript = `
try {
    if (!(Test-Path $dstFile)) { throw "File not found: $dstFile" }
    Set-FileSecurityFast $dstFile $aclJson
} catch {
    Write-Output ('{"error":' + (($_.Exception.Message | ConvertTo-Json -Compress)) + '}')
}
`;