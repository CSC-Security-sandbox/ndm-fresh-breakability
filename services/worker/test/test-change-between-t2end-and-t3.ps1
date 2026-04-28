# test-change-between-t2end-and-t3.ps1
# Simulates a single external ACL change on source between T2End and T3.
# Fires only on attempt 1 so the retry succeeds and stamps the new ACL.
# Removes all existing kiran rules, then adds Write permission. Does NOT restore.
#
# Expected result:
#   Attempt 1: T3 > T2End → conflict detected (changedAfterPreserveTimeAtSource=true)
#   Attempt 2: no change → stamp succeeds with kiran Write on destination
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File test-change-between-t2end-and-t3.ps1 `
#       -SharePath "\\server\share\file" -Attempt 1

param(
    [Parameter(Mandatory=$true)]
    [string]$SharePath,

    [int]$Attempt = 1
)

$Identity = "kiran"

if ($Attempt -gt 1) {
    Write-Host "SKIP | attempt=$Attempt | no change (retry should succeed)"
    exit 0
}

try {
    $acl = Get-Acl -Path $SharePath

    $existingRules = $acl.Access | Where-Object { $_.IdentityReference -like "*$Identity*" }
    if ($existingRules) {
        Write-Host "BEFORE | Existing ACL entries for ${Identity}:"
        $existingRules | ForEach-Object {
            Write-Host "         $($_.IdentityReference) | $($_.FileSystemRights) | $($_.AccessControlType)"
            $acl.RemoveAccessRule($_) | Out-Null
        }
        Write-Host "REMOVED | All existing rules for $Identity"
    } else {
        Write-Host "BEFORE | No existing ACL entries for $Identity"
    }

    $rights = [System.Security.AccessControl.FileSystemRights]::Write
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $Identity,
        $rights,
        [System.Security.AccessControl.InheritanceFlags]::None,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    )

    $acl.AddAccessRule($rule)
    Set-Acl -Path $SharePath -AclObject $acl

    $updatedAcl = Get-Acl -Path $SharePath
    $newRules = $updatedAcl.Access | Where-Object { $_.IdentityReference -like "*$Identity*" }
    Write-Host "AFTER  | Updated ACL entries for ${Identity}:"
    $newRules | ForEach-Object {
        Write-Host "         $($_.IdentityReference) | $($_.FileSystemRights) | $($_.AccessControlType)"
    }

    Write-Host "ADDED  | $rights (Allow) for $Identity"
    Write-Host "VERIFY | destination should have ONLY: $Identity -> $rights (Allow)"
} catch {
    Write-Host "ERROR | $($_.Exception.Message)"
    exit 1
}

Write-Host "DONE | attempt=$Attempt | path=$SharePath"
