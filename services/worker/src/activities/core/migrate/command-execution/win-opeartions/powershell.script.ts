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
$ALL_SECURITY_INFORMATION   = $OWNER_SECURITY_INFORMATION -bor $GROUP_SECURITY_INFORMATION -bor $DACL_SECURITY_INFORMATION -bor $SACL_SECURITY_INFORMATION 

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
    $SACL_SECURITY_INFORMATION  = 0x00000008
    $ALL_SECURITY_INFORMATION   = $OWNER_SECURITY_INFORMATION -bor $GROUP_SECURITY_INFORMATION -bor $DACL_SECURITY_INFORMATION -bor $SACL_SECURITY_INFORMATION 

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
    $saclAces = @()
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
    if ($sd.SystemAcl) {
        foreach ($ace in $sd.SystemAcl) {
            $saclAces += [PSCustomObject]@{
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
    $saclPresent   = ($ctrl -band [System.Security.AccessControl.ControlFlags]::SystemAclPresent) -ne 0
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

    # Get Alternate Data Streams if it's a file (not directory)
    $adsStreams = @()
    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
        try {
            $adsStreams = Get-FileADS -path $path
        } catch {
            # ADS enumeration failed, continue without ADS
        }
    }

    [PSCustomObject]@{
        Owner         = $owner
        Group         = $group
        DaclAces      = $daclAces
        AdsStreams    = $adsStreams
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
    # Build SACL if provided
    if ($securityInfo.SaclAces -and $securityInfo.SaclAces.Count -gt 0) {
        try {
            $saclInput = $securityInfo.SaclAces
            $sacl = New-Object System.Security.AccessControl.RawAcl(2, $saclInput.Count)
            for ($j = 0; $j -lt $saclInput.Count; $j++) {
                $sace = $saclInput[$j]
                $sid = New-Object System.Security.Principal.SecurityIdentifier($sace.Sid)
                $is_resolved = Map-Sid $sid
                if ($is_resolved -eq $false) { $unresolved_sids += $sid }
                if ($sace.AceType -eq 2 -or $sace.AceType -eq 3) { # SystemAudit/SystemAlarm
                    $qual = [System.Security.AccessControl.AceQualifier]::SystemAudit
                    $auditAce = New-Object System.Security.AccessControl.CommonAce(
                        [System.Security.AccessControl.AceFlags]$sace.AceFlags,
                        $qual,
                        [int]$sace.AccessMask,
                        $sid,
                        $false,
                        $null
                    )
                    $sacl.InsertAce($j, $auditAce)
                }
            }
            if ($sacl.Count -gt 0) {
                $sd.SystemAcl = $sacl
                $sd.SetFlags($sd.Control -bor [System.Security.AccessControl.ControlFlags]::SystemAclPresent)
            }
        } catch {
            # ignore SACL build errors to avoid breaking DACL stamping
        }
    }

    $SE_FILE_OBJECT = 1
    $OWNER_SECURITY_INFORMATION = 0x00000001
    $GROUP_SECURITY_INFORMATION = 0x00000002
    $DACL_SECURITY_INFORMATION  = 0x00000004
    $PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000
    $UNPROTECTED_DACL_SECURITY_INFORMATION = 0x20000000

    # Include protection flag to always disable inheritance
    $securityInfoFlags = $OWNER_SECURITY_INFORMATION -bor $GROUP_SECURITY_INFORMATION -bor $DACL_SECURITY_INFORMATION
    if ($sd.SystemAcl) { $securityInfoFlags = $securityInfoFlags -bor 0x00000008 }
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

    if ($result -ne 0) { throw "Error writing security info: $result" }

    # Set file attributes
    if ($securityInfo.Attributes) {
        $attrEnum = [System.Enum]::Parse([System.IO.FileAttributes], $securityInfo.Attributes)
        [System.IO.File]::SetAttributes($path, $attrEnum)
    }

    # Set Alternate Data Streams if provided and target is a file (not directory)
    $adsCopiedCount = 0
    if ($securityInfo.AdsStreams -and $securityInfo.AdsStreams.Count -gt 0 -and -not (Test-Path -LiteralPath $path -PathType Container)) {
        try {
            $adsCopiedCount = Set-FileADS -path $path -adsStreams $securityInfo.AdsStreams
        } catch {
            # ADS writing failed, continue without error to not break ACL stamping
        }
    }
        
    $unresolved_sid_values = @()
    if ($unresolved_sids.Count -gt 0) {
        $unresolved_sid_values = @($unresolved_sids | ForEach-Object { $_.Value })
        # Manually build JSON array
        $json_array = '[' + (($unresolved_sid_values | ForEach-Object { '"' + $_ + '"' }) -join ',') + ']'
        Write-Output ('{"success":true, "unresolved_sids":' + $json_array + ', "ads_copied":' + $adsCopiedCount + '}')
    } else {
        Write-Output ('{"success":true, "unresolved_sids":[], "ads_copied":' + $adsCopiedCount + '}')
    }
}

function Discover-FileADS([string]$path) {
    # Lightweight ADS discovery - only enumerate, don't read content
    $adsMetadata = @()
    
    try {
        # Get all streams for the file, excluding the main data stream
        $streams = Get-Item -LiteralPath $path -Stream * -ErrorAction SilentlyContinue | Where-Object { $_.Stream -ne ':$DATA' -and $_.Stream -ne '' }
        
        foreach ($stream in $streams) {
            try {
                # Quick type estimation based on stream name and size
                $estimatedType = 'unknown'
                $priority = 'normal'
                
                # Heuristic type detection from stream name
                switch -Regex ($stream.Stream) {
                    '(?i)(thumb|icon|image)' { $estimatedType = 'binary'; $priority = 'low' }
                    '(?i)(security|manifest|signature)' { $estimatedType = 'binary'; $priority = 'critical' }
                    '(?i)(meta|desc|comment|author)' { $estimatedType = 'text'; $priority = 'normal' }
                    '(?i)(zone\.identifier|quarantine)' { $priority = 'low' } # System streams
                    default { 
                        # Size-based heuristic
                        if ($stream.Length -lt 1024) { $estimatedType = 'text' }
                        elseif ($stream.Length -gt 1048576) { $estimatedType = 'binary' }
                    }
                }
                
                # Estimate transfer time based on size (rough calculation)
                $estimatedTransferTime = [math]::Max(100, $stream.Length / 10240) # Min 100ms, ~10KB/s baseline
                
                $adsMetadata += [PSCustomObject]@{
                    StreamName = $stream.Stream
                    Size = $stream.Length
                    EstimatedType = $estimatedType
                    Priority = $priority
                    EstimatedTransferTime = $estimatedTransferTime
                }
            } catch {
                # If we can't analyze the stream, include basic info
                $adsMetadata += [PSCustomObject]@{
                    StreamName = $stream.Stream
                    Size = $stream.Length
                    EstimatedType = 'unknown'
                    Priority = 'normal'
                    EstimatedTransferTime = 1000 # Default 1 second
                }
            }
        }
    } catch {
        # ADS discovery failed, return empty array
    }
    
    return $adsMetadata
}

function Get-FileADS([string]$path, [int]$maxSizeBytes = 10485760) { # Default 10MB limit
    $adsStreams = @()
    
    try {
        # Get all streams for the file, excluding the main data stream
        $streams = Get-Item -LiteralPath $path -Stream * -ErrorAction SilentlyContinue | Where-Object { $_.Stream -ne ':$DATA' -and $_.Stream -ne '' }
        
        foreach ($stream in $streams) {
            $streamPath = $path + ':' + $stream.Stream
            try {
                # Check if stream is too large for memory processing
                if ($stream.Length -gt $maxSizeBytes) {
                    # For large streams, store reference instead of content
                    $adsStreams += [PSCustomObject]@{
                        StreamName = $stream.Stream
                        Size = $stream.Length
                        Content = "[LARGE_STREAM:$($stream.Length)]"
                        IsBinary = $true
                        Encoding = 'chunked'
                        Checksum = ''
                        IsLarge = $true
                    }
                    continue
                }
                
                # Read stream as bytes first to detect binary content
                $bytes = Get-Content -LiteralPath $streamPath -AsByteStream -ErrorAction SilentlyContinue
                $isBinary = $false
                $content = ''
                $encoding = 'utf8'
                $checksum = ''
                
                if ($bytes -and $bytes.Length -gt 0) {
                    # Calculate MD5 checksum for integrity
                    $md5 = [System.Security.Cryptography.MD5]::Create()
                    $hashBytes = $md5.ComputeHash($bytes)
                    $checksum = [System.BitConverter]::ToString($hashBytes) -replace '-', ''
                    $md5.Dispose()
                    
                    # Detect binary content (contains null bytes or high percentage of non-printable chars)
                    $nullBytes = ($bytes | Where-Object { $_ -eq 0 }).Count
                    $nonPrintable = ($bytes | Where-Object { $_ -lt 32 -and $_ -ne 9 -and $_ -ne 10 -and $_ -ne 13 }).Count
                    
                    if ($nullBytes -gt 0 -or ($nonPrintable / $bytes.Length) -gt 0.3) {
                        $isBinary = $true
                        $encoding = 'base64'
                        $content = [System.Convert]::ToBase64String($bytes)
                    } else {
                        # Text content - convert from UTF8
                        $encoding = 'utf8'
                        $content = [System.Text.Encoding]::UTF8.GetString($bytes)
                    }
                }
                
                $adsStreams += [PSCustomObject]@{
                    StreamName = $stream.Stream
                    Size = $stream.Length
                    Content = $content
                    IsBinary = $isBinary
                    Encoding = $encoding
                    Checksum = $checksum
                    IsLarge = $false
                }
            } catch {
                # If we can't read the stream content, include it with empty content
                $adsStreams += [PSCustomObject]@{
                    StreamName = $stream.Stream
                    Size = $stream.Length
                    Content = ''
                    IsBinary = $false
                    Encoding = 'utf8'
                    Checksum = ''
                    IsLarge = $false
                }
            }
        }
    } catch {
        # ADS enumeration failed, return empty array
    }
    
    return $adsStreams
}

function Set-FileADS([string]$path, [array]$adsStreams) {
    $copiedCount = 0
    $errors = @()
    
    foreach ($ads in $adsStreams) {
        try {
            $streamPath = $path + ':' + $ads.StreamName
            
            if ($ads.IsLarge -and $ads.Encoding -eq 'chunked') {
                # Handle large streams - requires special processing
                $errors += "Large stream $($ads.StreamName) requires chunked transfer (not implemented in this version)"
                continue
            }
            
            if ($ads.IsBinary -and $ads.Encoding -eq 'base64') {
                # Handle binary content - decode from base64 and write as bytes
                $bytes = [System.Convert]::FromBase64String($ads.Content)
                [System.IO.File]::WriteAllBytes($streamPath, $bytes)
                
                # Verify checksum if provided
                if ($ads.Checksum) {
                    $writtenBytes = [System.IO.File]::ReadAllBytes($streamPath)
                    $md5 = [System.Security.Cryptography.MD5]::Create()
                    $hashBytes = $md5.ComputeHash($writtenBytes)
                    $writtenChecksum = [System.BitConverter]::ToString($hashBytes) -replace '-', ''
                    $md5.Dispose()
                    
                    if ($writtenChecksum -ne $ads.Checksum) {
                        $errors += "Checksum mismatch for stream $($ads.StreamName): expected $($ads.Checksum), got $writtenChecksum"
                        continue
                    }
                }
            } else {
                # Handle text content
                $encoding = switch ($ads.Encoding) {
                    'ascii' { [System.Text.Encoding]::ASCII }
                    'utf8' { [System.Text.Encoding]::UTF8 }
                    default { [System.Text.Encoding]::UTF8 }
                }
                
                $bytes = $encoding.GetBytes($ads.Content)
                [System.IO.File]::WriteAllBytes($streamPath, $bytes)
            }
            
            $copiedCount++
        } catch {
            $errors += "Failed to write stream $($ads.StreamName): $($_.Exception.Message)"
        }
    }
    
    # Log errors if any occurred
    if ($errors.Count -gt 0) {
        Write-Warning "ADS copy errors: $($errors -join '; ')"
    }
    
    return $copiedCount
}

function Copy-LargeADS([string]$sourcePath, [string]$targetPath, [string]$streamName, [int]$chunkSize = 1048576) {
    # Function to handle large ADS transfers in chunks (1MB default)
    $sourceStreamPath = $sourcePath + ':' + $streamName
    $targetStreamPath = $targetPath + ':' + $streamName
    
    try {
        $sourceStream = [System.IO.File]::OpenRead($sourceStreamPath)
        $targetStream = [System.IO.File]::Create($targetStreamPath)
        
        $buffer = New-Object byte[] $chunkSize
        $totalCopied = 0
        
        do {
            $bytesRead = $sourceStream.Read($buffer, 0, $chunkSize)
            if ($bytesRead -gt 0) {
                $targetStream.Write($buffer, 0, $bytesRead)
                $totalCopied += $bytesRead
            }
        } while ($bytesRead -eq $chunkSize)
        
        $sourceStream.Close()
        $targetStream.Close()
        
        return $totalCopied
    } catch {
        if ($sourceStream) { $sourceStream.Close() }
        if ($targetStream) { $targetStream.Close() }
        throw "Failed to copy large stream $streamName" + ": $_"
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

function Get-FileADS([string]$path) {
    try {
        $adsStreams = @()
        $streams = Get-Item -LiteralPath $path -Stream * -ErrorAction SilentlyContinue | Where-Object { $_.Stream -ne "::$DATA" }
        foreach ($stream in $streams) {
            try {
                # Use -Raw to get content as single string, not array of objects
                $content = Get-Content -LiteralPath $path -Stream $stream.Stream -Raw -ErrorAction SilentlyContinue
                # Ensure content is a string, not a PowerShell object
                if ($content -ne $null) {
                    $content = $content.ToString().TrimEnd([char[]]@(13,10))
                }
                $adsStreams += [PSCustomObject]@{
                    StreamName = $stream.Stream
                    Size = $stream.Length
                    Content = $content
                }
            } catch {
                # Skip streams that can't be read
            }
        }
        return $adsStreams
    } catch {
        return @()
    }
}

function Set-FileADS([string]$path, [array]$adsStreams) {
    try {
        $copiedCount = 0
        foreach ($ads in $adsStreams) {
            try {
                # Ensure we're writing string content, not PowerShell objects
                $contentToWrite = $ads.Content
                if ($contentToWrite -ne $null -and $contentToWrite -ne '') {
                    # Convert to string if it's not already
                    $contentString = $contentToWrite.ToString()
                    Set-Content -LiteralPath $path -Stream $ads.StreamName -Value $contentString -NoNewline -ErrorAction SilentlyContinue
                    $copiedCount++
                }
            } catch {
                # Skip streams that can't be written
            }
        }
        return $copiedCount
    } catch {
        return 0
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
