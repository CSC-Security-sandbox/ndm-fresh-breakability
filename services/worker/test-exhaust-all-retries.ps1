# test-exhaust-all-retries.ps1
# Exhausts all ctime validation retries by modifying source ACL on every attempt.
# Adds escalating permissions for user 'kiran' (Read → Write → FullControl).
# Does NOT restore permissions — verify on destination what got stamped.
#
# Expected result: PERM_STAMP_CTIME_CONFLICT after all attempts exhausted.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File test-exhaust-all-retries.ps1 `
#       -SharePath "\\server\share\file" -Attempt 1

param(
    [Parameter(Mandatory=$true)]
    [string]$SharePath,

    [int]$Attempt = 1
)

$Identity = "kiran"

function Add-PermissionForKiran {
    param(
        [string]$Path,
        [System.Security.AccessControl.FileSystemRights]$Rights
    )

    $acl = Get-Acl -Path $Path

    $existingRules = $acl.Access | Where-Object { $_.IdentityReference -like "*$Identity*" }
    if ($existingRules) {
        Write-Host "BEFORE | Existing ACL entries for ${Identity}:"
        $existingRules | ForEach-Object {
            Write-Host "         $($_.IdentityReference) | $($_.FileSystemRights) | $($_.AccessControlType)"
        }
    } else {
        Write-Host "BEFORE | No existing ACL entries for $Identity"
    }

    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $Identity,
        $Rights,
        [System.Security.AccessControl.InheritanceFlags]::None,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    )

    $acl.AddAccessRule($rule)
    Set-Acl -Path $Path -AclObject $acl

    $updatedAcl = Get-Acl -Path $Path
    $newRules = $updatedAcl.Access | Where-Object { $_.IdentityReference -like "*$Identity*" }
    Write-Host "AFTER  | Updated ACL entries for ${Identity}:"
    $newRules | ForEach-Object {
        Write-Host "         $($_.IdentityReference) | $($_.FileSystemRights) | $($_.AccessControlType)"
    }

    Write-Host "ADDED  | $Rights (Allow) for $Identity"
}

$permPerAttempt = @{
    1 = [System.Security.AccessControl.FileSystemRights]::Read
    2 = [System.Security.AccessControl.FileSystemRights]::Write
    3 = [System.Security.AccessControl.FileSystemRights]::FullControl
}

$rights = $permPerAttempt[$Attempt]
if (-not $rights) {
    $rights = [System.Security.AccessControl.FileSystemRights]::Modify
}

try {
    Write-Host "=== EXHAUST ALL RETRIES | attempt=$Attempt | Adding $rights for $Identity ==="
    Add-PermissionForKiran -Path $SharePath -Rights $rights
    Write-Host "VERIFY | expect PERM_STAMP_CTIME_CONFLICT (all retries should fail)"
} catch {
    Write-Host "ERROR | $($_.Exception.Message)"
    exit 1
}

Write-Host "DONE | attempt=$Attempt | path=$SharePath"
