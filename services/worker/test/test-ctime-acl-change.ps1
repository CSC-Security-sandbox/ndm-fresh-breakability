# test-ctime-acl-change.ps1
# Triggers ACL change on a source SMB path to bump its ctime.
# Used to test ctime detection during permission stamping.
#
# Fetches AD users and picks a random one for ACL changes.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File test-ctime-acl-change.ps1 -SharePath "\\server\share\file"
#
# AD Server: 172.30.202.5
# AD User:   adadmin
# AD Pass:   Datamigrator@123

param(
    [Parameter(Mandatory=$true)]
    [string]$SharePath,

    [string]$ADUser = "adadmin",
    [string]$ADPassword = "Datamigrator@123",
    [string]$ADServer = "172.30.202.5"
)

# Fetch AD users
Write-Host "Fetching users from AD server $ADServer ..."
$adUsers = @()
try {
    $secPassword = ConvertTo-SecureString $ADPassword -AsPlainText -Force
    $credential = New-Object System.Management.Automation.PSCredential($ADUser, $secPassword)
    $adUsers = Get-ADUser -Filter * -Server $ADServer -Credential $credential -Properties SamAccountName |
        Where-Object { $_.Enabled -eq $true } |
        Select-Object -ExpandProperty SamAccountName

    if ($adUsers.Count -eq 0) {
        Write-Host "No enabled AD users found. Exiting."
        exit 1
    }
    Write-Host "Found $($adUsers.Count) AD users"
} catch {
    Write-Host "AD fetch failed: $($_.Exception.Message). Exiting."
    exit 1
}

function Get-RandomPermission {
    $permissions = @(
        [System.Security.AccessControl.FileSystemRights]::Read,
        [System.Security.AccessControl.FileSystemRights]::Write,
        [System.Security.AccessControl.FileSystemRights]::ReadAndExecute,
        [System.Security.AccessControl.FileSystemRights]::Modify,
        [System.Security.AccessControl.FileSystemRights]::FullControl
    )
    return $permissions | Get-Random
}

$identity = $adUsers | Get-Random
$rights = Get-RandomPermission

try {
    $acl = Get-Acl -Path $SharePath

    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $identity,
        $rights,
        [System.Security.AccessControl.InheritanceFlags]::None,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    )

    $acl.AddAccessRule($rule)
    Set-Acl -Path $SharePath -AclObject $acl
    Write-Host "ACL ADDED | +$rights for $identity"

    Start-Sleep -Milliseconds 500

    $acl2 = Get-Acl -Path $SharePath
    $acl2.RemoveAccessRule($rule) | Out-Null
    Set-Acl -Path $SharePath -AclObject $acl2
    Write-Host "ACL REMOVED (restored)"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    exit 1
}
