# test-change-between-t3-and-dir-restamp.ps1
# Simulates an external ACL change on source directory AFTER T3 was stored
# during migration but BEFORE the deferred restamp preserves mtime at destination.
# Adds Modify permission for user 'kiran'. Does NOT restore.
#
# Expected result:
#   restamp-directories detects currentCtime > storedT3 → PERM_STAMP_CTIME_CONFLICT
#   mtime is still stamped on destination (by design), but conflict is flagged.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File test-change-between-t3-and-dir-restamp.ps1 `
#       -SharePath "\\server\share\folder"

param(
    [Parameter(Mandatory=$true)]
    [string]$SharePath
)

$Identity = "kiran"

try {
    $acl = Get-Acl -Path $SharePath

    $existingRules = $acl.Access | Where-Object { $_.IdentityReference -like "*$Identity*" }
    if ($existingRules) {
        Write-Host "BEFORE | Existing ACL entries for ${Identity}:"
        $existingRules | ForEach-Object {
            Write-Host "         $($_.IdentityReference) | $($_.FileSystemRights) | $($_.AccessControlType)"
        }
    } else {
        Write-Host "BEFORE | No existing ACL entries for $Identity"
    }

    $rights = [System.Security.AccessControl.FileSystemRights]::Modify
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
    Write-Host "VERIFY | restamp should flag PERM_STAMP_CTIME_CONFLICT for this directory"
} catch {
    Write-Host "ERROR | $($_.Exception.Message)"
    exit 1
}

Write-Host "DONE | path=$SharePath"
