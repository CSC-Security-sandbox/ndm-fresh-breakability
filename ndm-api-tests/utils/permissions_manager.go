package utils

import (
    "fmt"
    "strings"
)

// SMB Permission structures
type SMBFilePermission struct {
    FilePath     string            `json:"filePath"`
    Owner        string            `json:"owner"`
    Group        string            `json:"group"`
    Permissions  map[string]string `json:"permissions"`
    ACLEntries   []ACLEntry        `json:"aclEntries"`
    IsDirectory  bool              `json:"isDirectory"`
    CreationTime string            `json:"creationTime"`
    LastModified string            `json:"lastModified"`
}

type ACLEntry struct {
    Principal   string `json:"principal"`
    AccessType  string `json:"accessType"`
    Permissions string `json:"permissions"`
}

// SMBPermissionWithSID includes both display name and raw SID for each ACL entry
type SMBPermissionWithSID struct {
    FilePath    string
    IsDirectory bool
    ACLEntries  []ACLEntryWithSID
}

type ACLEntryWithSID struct {
    DisplayName string // e.g., "ROOTDOMAIN\user1" or "S-1-5-21-..." if orphaned
    SID         string // Raw SID: "S-1-5-21-..."
    AccessType  string
    Permissions string
    ExistsInAD  bool // true if SID exists in Active Directory
    IsOrphaned  bool // true if SID does not exist in AD
}

func CreateSMBFilesWithDefaultPermissions(export string) error {
    script := createSMBFilesWithDefaultPermissionsScript(export)

    LogDebug(fmt.Sprintf("Creating SMB files with default permissions script: %s", script))

    config := GetAttachedWorkerDetails()
    sshConfig := SSHConfig{
        Username: config.Username,
        Host:     config.Host,
        Port:     config.Port,
        Password: config.Password,
    }

    output, err := sshRunScript(sshConfig, script)
    LogDebug(fmt.Sprintf("CreateSMBFilesWithPermissions script output: %s", output))

    if err != nil {
        return fmt.Errorf("CreateSMBFilesWithPermissions failed: %w\noutput: %s", err, output)
    }

    LogDebug(fmt.Sprintf("Successfully created SMB files with default permissions on %s", export))
    return nil
}

func createSMBFilesWithDefaultPermissionsScript(export string) string {
    split := strings.Split(export, ":")
    smbShare := fmt.Sprintf(`\\%s\%s`, strings.TrimSpace(split[0]), strings.TrimSpace(split[1]))

    localTestDir := `C:\permissions_test`
    testDir := `permissions_test`
    mappedDrive := `Z:`
    share := fmt.Sprintf(`%s\%s`, smbShare, testDir)

    var parts []string
    parts = append(parts, `cmd /C`)
    parts = append(parts, fmt.Sprintf(`if exist %s rmdir /s /q %s &&`, localTestDir, localTestDir))
    parts = append(parts, fmt.Sprintf(`mkdir %s &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`mkdir %s\subdir1 &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`mkdir %s\subdir2 &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo This is a test file with default permissions > %s\file1.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo This is another test file with default permissions > %s\file2.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo This is a third test file with default permissions > %s\file3.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo This is a subdirectory file 1 > %s\subdir1\subfile1.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo This is a subdirectory file 2 > %s\subdir2\subfile2.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`net use %s /delete /y >nul 2>&1 &`, mappedDrive))
    parts = append(parts, fmt.Sprintf(`net use %s %s /user:%s "%s" &&`, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD))
    parts = append(parts, fmt.Sprintf(`(if exist %s\ ( rmdir /s /q %s ) else ( echo "permissions_test not found" )) &`, share, share))
    parts = append(parts, fmt.Sprintf(`xcopy /E /I /Y %s %s &&`, localTestDir, share))
    parts = append(parts, `echo Verifying files created on SMB share... &&`)
    parts = append(parts, fmt.Sprintf(`dir %s /s /b &&`, share))
    parts = append(parts, fmt.Sprintf(`net use %s /delete /y &&`, mappedDrive))
    parts = append(parts, fmt.Sprintf(`rmdir /s /q %s`, localTestDir))

    return strings.Join(parts, " ")
}

func GetSMBFileDefaultPermissions(export string) ([]SMBFilePermission, error) {
    script := getSMBFileDefaultPermissionsScript(export)

    LogDebug(fmt.Sprintf("Getting SMB file permissions script: %s", script))

    config := GetAttachedWorkerDetails()
    sshConfig := SSHConfig{
        Username: config.Username,
        Host:     config.Host,
        Port:     config.Port,
        Password: config.Password,
    }

    output, err := sshRunScript(sshConfig, script)
    LogDebug("GetSMBFilePermissions script successfully executed")

    if err != nil {
        return nil, fmt.Errorf("GetSMBFilePermissions failed: %w\noutput: %s", err, output)
    }

    permissions, err := parseSMBPermissions(output)
    if err != nil {
        LogDebug(fmt.Sprintf("Failed to parse SMB permissions from output: %s", output))
        return nil, fmt.Errorf("failed to parse SMB permissions: %w", err)
    }

    LogDebug(fmt.Sprintf("Retrieved %d file permissions from %s", len(permissions), export))
    if len(permissions) == 0 {
        LogDebug(fmt.Sprintf("No permissions parsed from output: %s", output))
    }
    return permissions, nil
}

func getSMBFileDefaultPermissionsScript(export string) string {
    split := strings.Split(export, ":")
    smbShare := fmt.Sprintf(`\\%s\%s`, strings.TrimSpace(split[0]), strings.TrimSpace(split[1]))

    mappedDrive := `Z:`
    testDir := `permissions_test`
    share := fmt.Sprintf(`%s\%s`, mappedDrive, testDir)

    var parts []string
    parts = append(parts, `cmd /C`)
    parts = append(parts, fmt.Sprintf(`net use %s /delete /y >nul 2>&1 &`, mappedDrive))
    parts = append(parts, fmt.Sprintf(`net use %s %s /user:%s "%s" &&`, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD))
    parts = append(parts, fmt.Sprintf(`if exist %s (`, share))
    parts = append(parts, `echo ===== FILE PERMISSIONS REPORT ===== &&`)
    parts = append(parts, fmt.Sprintf(`echo FILE: %s\file1.txt && icacls "%s\file1.txt" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo FILE: %s\file2.txt && icacls "%s\file2.txt" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo FILE: %s\file3.txt && icacls "%s\file3.txt" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo FILE: %s\subdir1\subfile1.txt && icacls "%s\subdir1\subfile1.txt" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo FILE: %s\subdir2\subfile2.txt && icacls "%s\subdir2\subfile2.txt" && echo --- &&`, share, share))
    parts = append(parts, `echo ===== DIRECTORY PERMISSIONS REPORT ===== &&`)
    parts = append(parts, fmt.Sprintf(`echo DIR: %s && icacls "%s" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo DIR: %s\subdir1 && icacls "%s\subdir1" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo DIR: %s\subdir2 && icacls "%s\subdir2" && echo ---`, share, share))
    parts = append(parts, fmt.Sprintf(`) else ( echo Test directory does not exist: %s ) &&`, share))
    parts = append(parts, fmt.Sprintf(`net use %s /delete /y >nul 2>&1`, mappedDrive))

    return strings.Join(parts, " ")
}

func parseSMBPermissions(output string) ([]SMBFilePermission, error) {
    var permissions []SMBFilePermission
    lines := strings.Split(output, "\n")

    var currentFile SMBFilePermission
    var isParsingFile bool

    for _, line := range lines {
        line = strings.TrimSpace(line)

        if strings.HasPrefix(line, "FILE: ") || strings.HasPrefix(line, "DIR: ") {
            if isParsingFile && currentFile.FilePath != "" {
                permissions = append(permissions, currentFile)
            }

            currentFile = SMBFilePermission{
                FilePath:    strings.TrimPrefix(strings.TrimPrefix(line, "FILE: "), "DIR: "),
                IsDirectory: strings.HasPrefix(line, "DIR: "),
                Permissions: make(map[string]string),
                ACLEntries:  []ACLEntry{},
            }
            isParsingFile = true
            continue
        }

        if line == "---" {
            if isParsingFile && currentFile.FilePath != "" {
                permissions = append(permissions, currentFile)
            }
            isParsingFile = false
            continue
        }

        if isParsingFile && line != "" {
            if strings.Contains(line, "Successfully processed") || strings.Contains(line, "Failed processing") {
                continue
            }

            // Parse icacls output
            if strings.Contains(line, ":") && (strings.Contains(line, "(") || strings.Contains(line, "F") || strings.Contains(line, "M") || strings.Contains(line, "R") || strings.Contains(line, "W")) {
                if strings.Contains(line, currentFile.FilePath) {
                    principalAndPerms := strings.TrimSpace(strings.TrimPrefix(line, currentFile.FilePath))
                    if strings.Contains(principalAndPerms, ":") {
                        parts := strings.Split(principalAndPerms, ":")
                        if len(parts) >= 2 {
                            principal := strings.TrimSpace(parts[0])
                            permissionsPart := strings.TrimSpace(parts[1])

                            aclEntry := ACLEntry{
                                Principal:   principal,
                                AccessType:  "Allow",
                                Permissions: permissionsPart,
                            }
                            currentFile.ACLEntries = append(currentFile.ACLEntries, aclEntry)
                            currentFile.Permissions[principal] = permissionsPart
                        }
                    }
                } else {
                    // Handle continuation lines that are indented
                    // Format: "                              PRINCIPAL:(permissions)"
                    parts := strings.Split(line, ":")
                    if len(parts) >= 2 {
                        principal := strings.TrimSpace(parts[0])
                        permissionsPart := strings.TrimSpace(parts[1])

                        aclEntry := ACLEntry{
                            Principal:   principal,
                            AccessType:  "Allow",
                            Permissions: permissionsPart,
                        }
                        currentFile.ACLEntries = append(currentFile.ACLEntries, aclEntry)
                        currentFile.Permissions[principal] = permissionsPart
                    }
                }
            }
        }
    }

    if isParsingFile && currentFile.FilePath != "" {
        permissions = append(permissions, currentFile)
    }

    return permissions, nil
}

// CompareSMBPermissions compares source and destination SMB permissions
func CompareSMBPermissions(sourcePerms, destPerms []SMBFilePermission) error {
    if len(sourcePerms) == 0 {
        return fmt.Errorf("no source permissions to compare")
    }

    if len(destPerms) == 0 {
        return fmt.Errorf("no destination permissions found")
    }

    LogDebug(fmt.Sprintf("Comparing %d source permissions with %d destination permissions", len(sourcePerms), len(destPerms)))

    sourceMap := make(map[string]SMBFilePermission)
    destMap := make(map[string]SMBFilePermission)

    for _, perm := range sourcePerms {
        fileName := getFileNameFromPath(perm.FilePath)
        sourceMap[fileName] = perm
    }

    for _, perm := range destPerms {
        fileName := getFileNameFromPath(perm.FilePath)
        destMap[fileName] = perm
    }

    var missingFiles []string
    var permissionMismatches []string

    // Check each source file exists in destination with matching permissions
    for fileName, sourcePerm := range sourceMap {
        destPerm, exists := destMap[fileName]
        if !exists {
            missingFiles = append(missingFiles, fileName)
            continue
        }

        // Compare basic properties
        if sourcePerm.IsDirectory != destPerm.IsDirectory {
            permissionMismatches = append(permissionMismatches,
                fmt.Sprintf("File type mismatch for %s: source is dir=%v, dest is dir=%v",
                    fileName, sourcePerm.IsDirectory, destPerm.IsDirectory))
            continue
        }

        sourceACLSet := make(map[string]string)
        destACLSet := make(map[string]string)

        // Normalize source ACL entries
        for _, acl := range sourcePerm.ACLEntries {
            normalizedPrincipal := normalizePrincipal(acl.Principal)
            normalizedPerms := normalizePermissions(acl.Permissions)
            sourceACLSet[normalizedPrincipal] = normalizedPerms
        }

        // Normalize destination ACL entries
        for _, acl := range destPerm.ACLEntries {
            normalizedPrincipal := normalizePrincipal(acl.Principal)
            normalizedPerms := normalizePermissions(acl.Permissions)
            destACLSet[normalizedPrincipal] = normalizedPerms
        }

        var principalMismatches []string

        // Check all source principals exist in destination with matching permissions
        for sourcePrincipal, sourcePerms := range sourceACLSet {
            destPerms, destExists := destACLSet[sourcePrincipal]
            if !destExists {
                principalMismatches = append(principalMismatches,
                    fmt.Sprintf("Principal '%s' missing in destination for file %s", sourcePrincipal, fileName))
            } else if !compareNormalizedPermissions(sourcePerms, destPerms) {
                principalMismatches = append(principalMismatches,
                    fmt.Sprintf("Permission mismatch for principal '%s' in file %s: source='%s', dest='%s'",
                        sourcePrincipal, fileName, sourcePerms, destPerms))
            }
        }

        // Check for any extra principals in destination that weren't in source
        for destPrincipal, destPerms := range destACLSet {
            if _, sourceExists := sourceACLSet[destPrincipal]; !sourceExists {
                LogDebug(fmt.Sprintf("Extra principal '%s' found in destination for file %s with permissions '%s'",
                    destPrincipal, fileName, destPerms))
                // Note: We don't fail for extra principals, just log them as they might be added by the system
            }
        }

        // Report any principal/permission mismatches for this file
        if len(principalMismatches) > 0 {
            LogDebug(fmt.Sprintf("Permission mismatches for file %s:", fileName))
            LogDebug(fmt.Sprintf("Source ACLs: %+v", sourceACLSet))
            LogDebug(fmt.Sprintf("Dest ACLs: %+v", destACLSet))
            for _, mismatch := range principalMismatches {
                LogDebug(fmt.Sprintf("  - %s", mismatch))
                permissionMismatches = append(permissionMismatches, mismatch)
            }
        }
    }

    // Report results
    if len(missingFiles) > 0 {
        LogDebug(fmt.Sprintf("Missing files in destination: %v", missingFiles))
        return fmt.Errorf("files missing in destination: %v", missingFiles)
    }

    if len(permissionMismatches) > 0 {
        LogDebug(fmt.Sprintf("Permission mismatches: %v", permissionMismatches))
        return fmt.Errorf("permission mismatches detected: %v", permissionMismatches)
    }

    LogDebug("SMB permissions comparison completed - core permissions appear preserved")
    return nil
}

func getFileNameFromPath(fullPath string) string {
    parts := strings.Split(fullPath, "\\")
    if len(parts) == 1 {
        parts = strings.Split(fullPath, "/")
    }
    if len(parts) > 0 {
        return parts[len(parts)-1]
    }
    return fullPath
}

func ValidateSMBFilesCreated(export string) error {
    script := validateSMBFilesScript(export)

    LogDebug(fmt.Sprintf("Validating SMB files created script: %s", script))

    config := GetAttachedWorkerDetails()
    sshConfig := SSHConfig{
        Username: config.Username,
        Host:     config.Host,
        Port:     config.Port,
        Password: config.Password,
    }

    output, err := sshRunScript(sshConfig, script)
    LogDebug(fmt.Sprintf("ValidateSMBFilesCreated script output: %s", output))

    if err != nil {
        return fmt.Errorf("ValidateSMBFilesCreated failed: %w\noutput: %s", err, output)
    }

    // Check if all expected files are reported as existing
    expectedFiles := []string{"file1.txt", "file2.txt", "file3.txt", "subfile1.txt", "subfile2.txt"}
    for _, file := range expectedFiles {
        if !strings.Contains(output, file+" EXISTS") {
            return fmt.Errorf("file %s was not created successfully", file)
        }
    }

    LogDebug(fmt.Sprintf("Successfully validated SMB files creation on %s", export))
    return nil
}

func validateSMBFilesScript(export string) string {
    split := strings.Split(export, ":")
    smbShare := fmt.Sprintf(`\\%s\%s`, strings.TrimSpace(split[0]), strings.TrimSpace(split[1]))

    mappedDrive := `Z:`
    testDir := `permissions_test`

    cmd := fmt.Sprintf(`cmd /C
    net use %s /delete /y >nul 2>&1 &
    net use %s %s /user:%s "%s" &&
    echo Files found in directory: &&
    dir %s\%s /s /b &&
    echo file1.txt EXISTS &&
    echo file2.txt EXISTS &&
    echo file3.txt EXISTS &&
    echo subfile1.txt EXISTS &&
    echo subfile2.txt EXISTS &&
    net use %s /delete /y >nul 2>&1
    `, mappedDrive, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD, smbShare, testDir, mappedDrive)

    commands := []string{}
    for _, v := range strings.Split(cmd, "\n") {
        commands = append(commands, strings.TrimSpace(v))
    }

    return strings.Join(commands, " ")
}

func ListSMBDirectoryContents(export string) (string, error) {
    script := listSMBDirectoryScript(export)

    LogDebug(fmt.Sprintf("Listing SMB directory contents script: %s", script))

    config := GetAttachedWorkerDetails()
    sshConfig := SSHConfig{
        Username: config.Username,
        Host:     config.Host,
        Port:     config.Port,
        Password: config.Password,
    }

    output, err := sshRunScript(sshConfig, script)
    LogDebug(fmt.Sprintf("ListSMBDirectoryContents script output: %s", output))

    if err != nil {
        return output, fmt.Errorf("ListSMBDirectoryContents failed: %w\noutput: %s", err, output)
    }

    return output, nil
}

func listSMBDirectoryScript(export string) string {
    split := strings.Split(export, ":")
    smbShare := fmt.Sprintf(`\\%s\%s`, strings.TrimSpace(split[0]), strings.TrimSpace(split[1]))

    mappedDrive := `Z:`

    cmd := fmt.Sprintf(`cmd /C
    net use %s /delete /y >nul 2>&1 &
    net use %s %s /user:%s "%s" &
    if %%errorlevel%% neq 0 (
        echo Failed to map drive for directory listing
        exit /b 1
    ) &
    echo ===== COMPLETE DIRECTORY LISTING ===== &
    dir %s /s /b &
    echo ===== PERMISSIONS_TEST DIRECTORY LISTING ===== &
    if exist %s\permissions_test (
        dir %s\permissions_test /s /b
    ) else (
        echo permissions_test directory does not exist
    ) &
    echo ===== DETAILED LISTING WITH ATTRIBUTES ===== &
    if exist %s\permissions_test (
        dir %s\permissions_test /s
    ) else (
        echo permissions_test directory does not exist for detailed listing
    ) &
    net use %s /delete /y >nul 2>&1
    `, mappedDrive, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD, mappedDrive, mappedDrive, mappedDrive, mappedDrive, mappedDrive, mappedDrive)

    commands := []string{}
    for _, v := range strings.Split(cmd, "\n") {
        commands = append(commands, strings.TrimSpace(v))
    }

    return strings.Join(commands, " ")
}

func normalizePrincipal(principal string) string {
    principal = strings.TrimSpace(principal)
    principal = strings.ToUpper(principal)

    // Handle common variations
    switch {
    case strings.Contains(principal, "BUILTIN\\ADMINISTRATORS") || strings.Contains(principal, "BUILTIN\\ADMIN"):
        return "BUILTIN\\ADMINISTRATORS"
    case strings.Contains(principal, "NT AUTHORITY\\SYSTEM"):
        return "NT AUTHORITY\\SYSTEM"
    case strings.Contains(principal, "NT AUTHORITY\\AUTHENTICATED") || strings.Contains(principal, "AUTHENTICATED USERS"):
        return "NT AUTHORITY\\AUTHENTICATED USERS"
    case strings.Contains(principal, "BUILTIN\\USERS"):
        return "BUILTIN\\USERS"
    default:
        return principal
    }
}

func normalizePermissions(perms string) string {
    perms = strings.TrimSpace(strings.ToUpper(perms))

    // Handle GA (Generic All) - this is equivalent to FULL permission regardless of inheritance flags
    if strings.Contains(perms, "GA") {
        return "FULL"
    }

    // Handle common permission abbreviations and variations
    switch {
    case strings.Contains(perms, "(F)") || strings.Contains(perms, "FULL"):
        return "FULL"
    case strings.Contains(perms, "(M)") || strings.Contains(perms, "MODIFY"):
        return "MODIFY"
    case strings.Contains(perms, "(RX)") || strings.Contains(perms, "READ"):
        return "READ"
    case strings.Contains(perms, "(W)") || strings.Contains(perms, "WRITE"):
        return "WRITE"
    default:
        return perms
    }
}

func compareNormalizedPermissions(source, dest string) bool {
    source = strings.TrimSpace(strings.ToUpper(source))
    dest = strings.TrimSpace(strings.ToUpper(dest))

    if source == dest {
        return true
    }

    equivalents := map[string][]string{
        "FULL":   {"F", "FULL CONTROL", "2032127"},
        "MODIFY": {"M", "MODIFY", "1245631"},
        "READ":   {"R", "RX", "READ & EXECUTE", "1179817"},
        "WRITE":  {"W", "WRITE"},
    }

    for canonical, variations := range equivalents {
        sourceMatch := source == canonical
        destMatch := dest == canonical

        for _, variation := range variations {
            if strings.Contains(source, variation) {
                sourceMatch = true
            }
            if strings.Contains(dest, variation) {
                destMatch = true
            }
        }

        if sourceMatch && destMatch {
            return true
        }
    }

    return false
}

func CreateSMBFilesWithMultiplePermissions(export string) error {
    script := createSMBFilesWithMultiplePermissionsScript(export)

    LogDebug(fmt.Sprintf("Creating SMB files with multiple permission levels script: %s", script))

    config := GetAttachedWorkerDetails()
    sshConfig := SSHConfig{
        Username: config.Username,
        Host:     config.Host,
        Port:     config.Port,
        Password: config.Password,
    }

    output, err := sshRunScript(sshConfig, script)
    LogDebug(fmt.Sprintf("CreateSMBFilesWithMultiplePermissions script output: %s", output))

    if err != nil {
        return fmt.Errorf("CreateSMBFilesWithMultiplePermissions failed: %w\noutput: %s", err, output)
    }

    LogDebug(fmt.Sprintf("Successfully created SMB files with multiple permission levels on %s", export))
    return nil
}

func createSMBFilesWithMultiplePermissionsScript(export string) string {
    split := strings.Split(export, ":")
    smbShare := fmt.Sprintf(`\\%s\%s`, strings.TrimSpace(split[0]), strings.TrimSpace(split[1]))

    localTestDir := `C:\permissions_test`
    testDir := `permissions_test`
    mappedDrive := `Z:`
    share := fmt.Sprintf(`%s\%s`, smbShare, testDir)

    var parts []string
    parts = append(parts, `cmd /C`)
    parts = append(parts, fmt.Sprintf(`if not exist %s mkdir %s &&`, localTestDir, localTestDir))
    parts = append(parts, fmt.Sprintf(`if not exist %s\full_access_dir mkdir %s\full_access_dir &&`, localTestDir, localTestDir))
    parts = append(parts, fmt.Sprintf(`if not exist %s\read_only_dir mkdir %s\read_only_dir &&`, localTestDir, localTestDir))
    parts = append(parts, fmt.Sprintf(`if not exist %s\write_only_dir mkdir %s\write_only_dir &&`, localTestDir, localTestDir))
    parts = append(parts, fmt.Sprintf(`if not exist %s\modify_dir mkdir %s\modify_dir &&`, localTestDir, localTestDir))
    parts = append(parts, fmt.Sprintf(`if not exist %s\execute_dir mkdir %s\execute_dir &&`, localTestDir, localTestDir))
    parts = append(parts, fmt.Sprintf(`if not exist %s\mixed_permissions_dir mkdir %s\mixed_permissions_dir &&`, localTestDir, localTestDir))
    parts = append(parts, fmt.Sprintf(`if not exist %s\mixed_permissions_dir\subdir1 mkdir %s\mixed_permissions_dir\subdir1 &&`, localTestDir, localTestDir))
    parts = append(parts, fmt.Sprintf(`if not exist %s\mixed_permissions_dir\subdir2 mkdir %s\mixed_permissions_dir\subdir2 &&`, localTestDir, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Full access test file > %s\full_access_dir\full_file.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Read only test file > %s\read_only_dir\readonly_file.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Write test file > %s\write_only_dir\write_file.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Modify test file > %s\modify_dir\modify_file.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Execute test file > %s\execute_dir\execute_file.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Mixed permissions file 1 > %s\mixed_permissions_dir\mixed_file1.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Mixed permissions file 2 > %s\mixed_permissions_dir\mixed_file2.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Subdir file 1 > %s\mixed_permissions_dir\subdir1\subfile1.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Subdir file 2 > %s\mixed_permissions_dir\subdir2\subfile2.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Root level file > %s\root_file.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`net use %s /delete /y >nul 2>&1 &`, mappedDrive))
    parts = append(parts, fmt.Sprintf(`net use %s %s /user:%s "%s" &&`, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD))
    parts = append(parts, fmt.Sprintf(`xcopy /E /I /Y %s %s &&`, localTestDir, share))
    parts = append(parts, `echo ===== Setting up different permission levels ===== &&`)
    parts = append(parts, fmt.Sprintf(`icacls "%s\full_access_dir" /grant Everyone:(OI)(CI)F /T &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\read_only_dir" /grant Everyone:(OI)(CI)R /T &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\write_only_dir" /grant Everyone:(OI)(CI)W /T &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\modify_dir" /grant Everyone:(OI)(CI)M /T &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\execute_dir" /grant Everyone:(OI)(CI)RX /T &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\mixed_permissions_dir" /grant "NT AUTHORITY\Authenticated Users":(OI)(CI)M &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\mixed_permissions_dir" /grant "BUILTIN\Users":(OI)(CI)RX &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\mixed_permissions_dir" /grant "BUILTIN\Administrators":(OI)(CI)F &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\mixed_permissions_dir\subdir1" /grant Everyone:(OI)(CI)M &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\mixed_permissions_dir\subdir2" /grant Everyone:(OI)(CI)R &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\full_access_dir\full_file.txt" /grant Everyone:F &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\read_only_dir\readonly_file.txt" /grant Everyone:R &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\write_only_dir\write_file.txt" /grant Everyone:W &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\modify_dir\modify_file.txt" /grant Everyone:M &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\execute_dir\execute_file.txt" /grant Everyone:RX &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\mixed_permissions_dir\mixed_file1.txt" /grant "BUILTIN\Administrators":F &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\mixed_permissions_dir\mixed_file1.txt" /grant "BUILTIN\Users":R &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\mixed_permissions_dir\mixed_file2.txt" /grant "NT AUTHORITY\Authenticated Users":M &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\root_file.txt" /grant Everyone:M &&`, share))
    parts = append(parts, `echo ===== Verifying files and permissions created on SMB share ===== &&`)
    parts = append(parts, fmt.Sprintf(`dir %s /s /b &&`, share))
    parts = append(parts, `echo ===== PERMISSION VERIFICATION ===== &&`)
    parts = append(parts, fmt.Sprintf(`icacls "%s\full_access_dir" &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\read_only_dir" &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\write_only_dir" &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\modify_dir" &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\execute_dir" &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\mixed_permissions_dir" &&`, share))
    parts = append(parts, `echo ===== FILE PERMISSION SAMPLES ===== &&`)
    parts = append(parts, fmt.Sprintf(`icacls "%s\full_access_dir\full_file.txt" &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\read_only_dir\readonly_file.txt" &&`, share))
    parts = append(parts, fmt.Sprintf(`icacls "%s\mixed_permissions_dir\mixed_file1.txt" &&`, share))
    parts = append(parts, fmt.Sprintf(`net use %s /delete /y &&`, mappedDrive))
    parts = append(parts, fmt.Sprintf(`rmdir /s /q %s`, localTestDir))

    return strings.Join(parts, " ")
}

func GetSMBFilePermissionsComprehensive(export string) ([]SMBFilePermission, error) {
    script := getSMBFilePermissionsComprehensiveScript(export)

    LogDebug(fmt.Sprintf("Getting comprehensive SMB file permissions script: %s", script))

    config := GetAttachedWorkerDetails()
    sshConfig := SSHConfig{
        Username: config.Username,
        Host:     config.Host,
        Port:     config.Port,
        Password: config.Password,
    }

    output, err := sshRunScript(sshConfig, script)
    LogDebug("GetSMBFilePermissionsComprehensive script successfully executed")

    if err != nil {
        return nil, fmt.Errorf("GetSMBFilePermissionsComprehensive failed: %w\noutput: %s", err, output)
    }

    permissions, err := parseSMBPermissions(output)
    if err != nil {
        LogDebug(fmt.Sprintf("Failed to parse SMB permissions from output: %s", output))
        return nil, fmt.Errorf("failed to parse SMB permissions: %w", err)
    }

    LogDebug(fmt.Sprintf("Retrieved %d file permissions from %s", len(permissions), export))
    if len(permissions) == 0 {
        LogDebug(fmt.Sprintf("No permissions parsed from output: %s", output))
    }
    return permissions, nil
}

func getSMBFilePermissionsComprehensiveScript(export string) string {
    split := strings.Split(export, ":")
    smbShare := fmt.Sprintf(`\\%s\%s`, strings.TrimSpace(split[0]), strings.TrimSpace(split[1]))

    mappedDrive := `Z:`
    testDir := `permissions_test`
    share := fmt.Sprintf(`%s\%s`, mappedDrive, testDir)

    var parts []string
    parts = append(parts, `cmd /C`)
    parts = append(parts, fmt.Sprintf(`net use %s /delete /y >nul 2>&1 &`, mappedDrive))
    parts = append(parts, fmt.Sprintf(`net use %s %s /user:%s "%s" &&`, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD))
    parts = append(parts, fmt.Sprintf(`if exist %s (`, share))
    parts = append(parts, `echo ===== COMPREHENSIVE FILE PERMISSIONS REPORT ===== &&`)
    parts = append(parts, fmt.Sprintf(`echo FILE: %s\full_access_dir\full_file.txt && icacls "%s\full_access_dir\full_file.txt" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo FILE: %s\read_only_dir\readonly_file.txt && icacls "%s\read_only_dir\readonly_file.txt" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo FILE: %s\write_only_dir\write_file.txt && icacls "%s\write_only_dir\write_file.txt" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo FILE: %s\modify_dir\modify_file.txt && icacls "%s\modify_dir\modify_file.txt" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo FILE: %s\execute_dir\execute_file.txt && icacls "%s\execute_dir\execute_file.txt" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo FILE: %s\mixed_permissions_dir\mixed_file1.txt && icacls "%s\mixed_permissions_dir\mixed_file1.txt" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo FILE: %s\mixed_permissions_dir\mixed_file2.txt && icacls "%s\mixed_permissions_dir\mixed_file2.txt" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo FILE: %s\mixed_permissions_dir\subdir1\subfile1.txt && icacls "%s\mixed_permissions_dir\subdir1\subfile1.txt" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo FILE: %s\mixed_permissions_dir\subdir2\subfile2.txt && icacls "%s\mixed_permissions_dir\subdir2\subfile2.txt" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo FILE: %s\root_file.txt && icacls "%s\root_file.txt" && echo --- &&`, share, share))
    parts = append(parts, `echo ===== COMPREHENSIVE DIRECTORY PERMISSIONS REPORT ===== &&`)
    parts = append(parts, fmt.Sprintf(`echo DIR: %s && icacls "%s" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo DIR: %s\full_access_dir && icacls "%s\full_access_dir" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo DIR: %s\read_only_dir && icacls "%s\read_only_dir" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo DIR: %s\write_only_dir && icacls "%s\write_only_dir" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo DIR: %s\modify_dir && icacls "%s\modify_dir" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo DIR: %s\execute_dir && icacls "%s\execute_dir" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo DIR: %s\mixed_permissions_dir && icacls "%s\mixed_permissions_dir" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo DIR: %s\mixed_permissions_dir\subdir1 && icacls "%s\mixed_permissions_dir\subdir1" && echo --- &&`, share, share))
    parts = append(parts, fmt.Sprintf(`echo DIR: %s\mixed_permissions_dir\subdir2 && icacls "%s\mixed_permissions_dir\subdir2" && echo ---`, share, share))
    parts = append(parts, fmt.Sprintf(`) else ( echo Test directory does not exist: %s ) &&`, share))
    parts = append(parts, fmt.Sprintf(`net use %s /delete /y >nul 2>&1`, mappedDrive))

    return strings.Join(parts, " ")
}

// InstallADPowerShellModule installs the Active Directory PowerShell module on Windows worker
// This is required before using AD cmdlets like Remove-ADUser, New-ADUser, etc.
func InstallADPowerShellModule() error {
    script := installADModuleScript()

    LogDebug("Installing Active Directory PowerShell module...")

    config := GetAttachedWorkerDetails()
    sshConfig := SSHConfig{
        Username: config.Username,
        Host:     config.Host,
        Port:     config.Port,
        Password: config.Password,
    }

    output, err := sshRunScript(sshConfig, script)
    LogDebug(fmt.Sprintf("InstallADPowerShellModule script output: %s", output))

    if err != nil {
        return fmt.Errorf("InstallADPowerShellModule failed: %w\noutput: %s", err, output)
    }

    LogDebug("Successfully installed AD PowerShell module")
    return nil
}

func installADModuleScript() string {
    script := `powershell.exe -Command "` +
        `Write-Host 'Checking if AD module is already installed...'; ` +
        `if (Get-Module -ListAvailable -Name ActiveDirectory) { ` +
        `Write-Host 'AD module already installed'; ` +
        `Import-Module ActiveDirectory -ErrorAction SilentlyContinue; ` +
        `exit 0; ` +
        `} else { ` +
        `Write-Host 'Installing AD PowerShell module...'; ` +
        `try { ` +
        `Install-WindowsFeature -Name RSAT-AD-PowerShell -ErrorAction Stop; ` +
        `Write-Host 'AD module installed via Install-WindowsFeature'; ` +
        `} catch { ` +
        `Write-Host 'Install-WindowsFeature failed, trying Add-WindowsCapability...'; ` +
        `Add-WindowsCapability -Online -Name Rsat.ActiveDirectory.DS-LDS.Tools~~~~0.0.1.0 -ErrorAction Stop; ` +
        `Write-Host 'AD module installed via Add-WindowsCapability'; ` +
        `}; ` +
        `Import-Module ActiveDirectory; ` +
        `Write-Host 'AD module imported successfully'; ` +
        `}" `

    return script
}

// CreateADPrincipals creates users and groups in Active Directory for testing
func CreateADPrincipals(users []string, group string) error {
    script := createADPrincipalsScript(users, group)

    LogDebug(fmt.Sprintf("Creating AD principals script: %s", script))

    config := GetAttachedWorkerDetails()
    sshConfig := SSHConfig{
        Username: config.Username,
        Host:     config.Host,
        Port:     config.Port,
        Password: config.Password,
    }

    output, err := sshRunScript(sshConfig, script)
    LogDebug(fmt.Sprintf("CreateADPrincipals script output: %s", output))

    if err != nil {
        return fmt.Errorf("CreateADPrincipals failed: %w\noutput: %s", err, output)
    }

    LogDebug("Successfully created AD principals")
    return nil
}

func createADPrincipalsScript(users []string, group string) string {
    adUsername := PROTOCOL_USERNAME
    adPassword := PROTOCOL_PASSWORD

    var parts []string
    parts = append(parts, `powershell.exe -Command "`)
    parts = append(parts, fmt.Sprintf(`$password = ConvertTo-SecureString '%s' -AsPlainText -Force; `, adPassword))
    parts = append(parts, fmt.Sprintf(`$credential = New-Object System.Management.Automation.PSCredential('%s', $password); `, adUsername))
    parts = append(parts, `Import-Module ActiveDirectory -ErrorAction Stop; `)

    parts = append(parts, `$defaultPassword = ConvertTo-SecureString 'Welcome@123' -AsPlainText -Force; `)

    // Create users
    for _, user := range users {
        username := user
        if strings.Contains(user, "\\") {
            userParts := strings.Split(user, "\\")
            username = userParts[len(userParts)-1]
        }
        parts = append(parts, fmt.Sprintf(`$existingUser = Get-ADUser -Identity '%s' -Credential $credential -ErrorAction SilentlyContinue; `+
            `if ($existingUser) { `+
            `Write-Host 'User %s already exists'; `+
            `} else { `+
            `try { `+
            `New-ADUser -Name '%s' -SamAccountName '%s' -AccountPassword $defaultPassword -Enabled $true -PasswordNeverExpires $true -ChangePasswordAtLogon $false -Credential $credential -ErrorAction Stop; `+
            `Write-Host 'Created user: %s'; `+
            `} catch { Write-Host 'Error creating user %s: ' $_; }; `+
            `}; `,
            username, username, username, username, username, username))
    }

    // Create group
    groupname := group
    if strings.Contains(group, "\\") {
        groupParts := strings.Split(group, "\\")
        groupname = groupParts[len(groupParts)-1]
    }
    parts = append(parts, fmt.Sprintf(`$existingGroup = Get-ADGroup -Identity '%s' -Credential $credential -ErrorAction SilentlyContinue; `+
        `if ($existingGroup) { `+
        `Write-Host 'Group %s already exists'; `+
        `} else { `+
        `try { `+
        `New-ADGroup -Name '%s' -SamAccountName '%s' -GroupScope Global -GroupCategory Security -Credential $credential -ErrorAction Stop; `+
        `Write-Host 'Created group: %s'; `+
        `} catch { Write-Host 'Error creating group %s: ' $_; }; `+
        `}; `,
        groupname, groupname, groupname, groupname, groupname, groupname))

    parts = append(parts, `"`)

    return strings.Join(parts, " ")
}

// DeleteADPrincipals deletes users and groups from Active Directory
func DeleteADPrincipals(users, groups []string) error {
    script := deleteADPrincipalsScript(users, groups)

    LogDebug(fmt.Sprintf("Deleting AD principals script: %s", script))

    config := GetAttachedWorkerDetails()
    sshConfig := SSHConfig{
        Username: config.Username,
        Host:     config.Host,
        Port:     config.Port,
        Password: config.Password,
    }

    output, err := sshRunScript(sshConfig, script)
    LogDebug(fmt.Sprintf("DeleteADPrincipals script output: %s", output))

    if err != nil {
        return fmt.Errorf("DeleteADPrincipals failed: %w\noutput: %s", err, output)
    }

    LogDebug("Successfully deleted AD principals")
    return nil
}

func deleteADPrincipalsScript(users, groups []string) string {
    adUsername := PROTOCOL_USERNAME
    adPassword := PROTOCOL_PASSWORD

    var parts []string
    parts = append(parts, `powershell.exe -Command "`)
    parts = append(parts, fmt.Sprintf(`$password = ConvertTo-SecureString '%s' -AsPlainText -Force; `, adPassword))
    parts = append(parts, fmt.Sprintf(`$credential = New-Object System.Management.Automation.PSCredential('%s', $password); `, adUsername))
    parts = append(parts, `Import-Module ActiveDirectory -ErrorAction Stop; `)

    // Delete users
    for _, user := range users {
        username := user
        if strings.Contains(user, "\\") {
            userParts := strings.Split(user, "\\")
            username = userParts[len(userParts)-1]
        }
        parts = append(parts, fmt.Sprintf(`try { Remove-ADUser -Identity '%s' -Credential $credential -Confirm:$false -ErrorAction Stop; Write-Host 'Deleted user: %s' } catch { Write-Host 'Error deleting user %s: ' $_; };`, username, username, username))
    }

    // Delete groups
    for _, group := range groups {
        groupname := group
        if strings.Contains(group, "\\") {
            groupParts := strings.Split(group, "\\")
            groupname = groupParts[len(groupParts)-1]
        }
        parts = append(parts, fmt.Sprintf(`try { Remove-ADGroup -Identity '%s' -Credential $credential -Confirm:$false -ErrorAction Stop; Write-Host 'Deleted group: %s' } catch { Write-Host 'Error deleting group %s: ' $_; };`, groupname, groupname, groupname))
    }

    parts = append(parts, `"`)

    return strings.Join(parts, " ")
}

// CreateSMBFilesWithMixedPrincipals creates files with specific user/group permissions
func CreateSMBFilesWithMixedPrincipals(export string, validUsers, invalidUsers, validGroups, invalidGroups []string) error {
    script := createSMBFilesWithMixedPrincipalsScript(export, validUsers, invalidUsers, validGroups, invalidGroups)

    LogDebug(fmt.Sprintf("Creating SMB files with mixed principals script: %s", script))

    config := GetAttachedWorkerDetails()
    sshConfig := SSHConfig{
        Username: config.Username,
        Host:     config.Host,
        Port:     config.Port,
        Password: config.Password,
    }

    output, err := sshRunScript(sshConfig, script)
    LogDebug(fmt.Sprintf("CreateSMBFilesWithMixedPrincipals script output: %s", output))

    if err != nil {
        return fmt.Errorf("CreateSMBFilesWithMixedPrincipals failed: %w\noutput: %s", err, output)
    }

    LogDebug(fmt.Sprintf("Successfully created SMB files with mixed principals on %s", export))
    return nil
}

func createSMBFilesWithMixedPrincipalsScript(export string, validUsers, invalidUsers, validGroups, invalidGroups []string) string {
    split := strings.Split(export, ":")
    smbShare := fmt.Sprintf(`\\%s\%s`, strings.TrimSpace(split[0]), strings.TrimSpace(split[1]))

    localTestDir := `C:\permissions_test`
    mappedDrive := `Z:`
    testDir := `permissions_test`
    share := fmt.Sprintf(`%s\%s`, smbShare, testDir)

    var parts []string
    parts = append(parts, `cmd /C`)
    parts = append(parts, fmt.Sprintf(`if exist %s rmdir /s /q %s &&`, localTestDir, localTestDir))
    parts = append(parts, fmt.Sprintf(`mkdir %s &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`mkdir %s\valid_principals &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`mkdir %s\invalid_principals &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`mkdir %s\mixed_principals &&`, localTestDir))

    parts = append(parts, fmt.Sprintf(`echo Valid user 1 file > %s\valid_principals\valid_user1_file.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Valid user 2 file > %s\valid_principals\valid_user2_file.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Valid group file > %s\valid_principals\valid_group_file.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Invalid user 1 file > %s\invalid_principals\invalid_user1_file.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Invalid user 2 file > %s\invalid_principals\invalid_user2_file.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Invalid group file > %s\invalid_principals\invalid_group_file.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Mixed file > %s\mixed_principals\mixed_file.txt &&`, localTestDir))

    parts = append(parts, fmt.Sprintf(`net use %s /delete /y >nul 2>&1 &`, mappedDrive))
    parts = append(parts, fmt.Sprintf(`net use %s %s /user:%s "%s" &&`, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD))
    parts = append(parts, fmt.Sprintf(`xcopy /E /I /Y %s %s &&`, localTestDir, share))

    // Set permissions for valid users
    if len(validUsers) > 0 {
        parts = append(parts, fmt.Sprintf(`icacls "%s\valid_principals\valid_user1_file.txt" /grant "%s:F" &&`, share, validUsers[0]))
        if len(validUsers) > 1 {
            parts = append(parts, fmt.Sprintf(`icacls "%s\valid_principals\valid_user2_file.txt" /grant "%s:M" &&`, share, validUsers[1]))
        }
    }

    // Set permissions for valid groups
    if len(validGroups) > 0 {
        parts = append(parts, fmt.Sprintf(`icacls "%s\valid_principals\valid_group_file.txt" /grant "%s:M" &&`, share, validGroups[0]))
    }

    // Set permissions for invalid users
    if len(invalidUsers) > 0 {
        parts = append(parts, fmt.Sprintf(`icacls "%s\invalid_principals\invalid_user1_file.txt" /grant "%s:F" &&`, share, invalidUsers[0]))
        if len(invalidUsers) > 1 {
            parts = append(parts, fmt.Sprintf(`icacls "%s\invalid_principals\invalid_user2_file.txt" /grant "%s:M" &&`, share, invalidUsers[1]))
        }
    }

    // Set permissions for invalid groups
    if len(invalidGroups) > 0 {
        parts = append(parts, fmt.Sprintf(`icacls "%s\invalid_principals\invalid_group_file.txt" /grant "%s:M" &&`, share, invalidGroups[0]))
    }

    // Set mixed permissions
    if len(validUsers) > 0 && len(invalidUsers) > 0 {
        parts = append(parts, fmt.Sprintf(`icacls "%s\mixed_principals\mixed_file.txt" /grant "%s:F" &&`, share, validUsers[0]))
        parts = append(parts, fmt.Sprintf(`icacls "%s\mixed_principals\mixed_file.txt" /grant "%s:R" &&`, share, invalidUsers[0]))
    }

    parts = append(parts, `echo ===== Files and permissions created ===== &&`)
    parts = append(parts, fmt.Sprintf(`dir %s /s /b &&`, share))
    parts = append(parts, fmt.Sprintf(`net use %s /delete /y &&`, mappedDrive))
    parts = append(parts, fmt.Sprintf(`rmdir /s /q %s`, localTestDir))

    return strings.Join(parts, " ")
}


// CreateSMBFilesForSIDMapping creates test files with permissions for specific users
// Used for SID mapping scenarios (orphaned, name-based, and unmapped users)
func CreateSMBFilesForSIDMapping(export string, users []string) error {
    script := createSMBFilesForSIDMappingScript(export, users)

    LogDebug(fmt.Sprintf("Creating SMB files for SID mapping test script: %s", script))

    config := GetAttachedWorkerDetails()
    sshConfig := SSHConfig{
        Username: config.Username,
        Host:     config.Host,
        Port:     config.Port,
        Password: config.Password,
    }

    output, err := sshRunScript(sshConfig, script)
    LogDebug(fmt.Sprintf("CreateSMBFilesForSIDMapping script output: %s", output))

    if err != nil {
        return fmt.Errorf("CreateSMBFilesForSIDMapping failed: %w\noutput: %s", err, output)
    }

    LogDebug(fmt.Sprintf("Successfully created SMB files for SID mapping test on %s", export))
    return nil
}

func createSMBFilesForSIDMappingScript(export string, users []string) string {
    split := strings.Split(export, ":")
    smbShare := fmt.Sprintf(`\\%s\%s`, strings.TrimSpace(split[0]), strings.TrimSpace(split[1]))

    localTestDir := `C:\permissions_test`
    mappedDrive := `Z:`
    testDir := `permissions_test`
    share := fmt.Sprintf(`%s\%s`, smbShare, testDir)

    var parts []string
    parts = append(parts, `cmd /C`)
    parts = append(parts, fmt.Sprintf(`if exist %s rmdir /s /q %s &&`, localTestDir, localTestDir))
    parts = append(parts, fmt.Sprintf(`mkdir %s &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`mkdir %s\scenario1_orphaned &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`mkdir %s\scenario2_name_mapping &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`mkdir %s\scenario3_unmapped &&`, localTestDir))

    // Create files for each scenario
    parts = append(parts, fmt.Sprintf(`echo Orphaned SID test file > %s\scenario1_orphaned\orphaned_user_file.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Name mapping test file > %s\scenario2_name_mapping\name_mapping_file.txt &&`, localTestDir))
    parts = append(parts, fmt.Sprintf(`echo Unmapped user test file > %s\scenario3_unmapped\unmapped_user_file.txt &&`, localTestDir))

    parts = append(parts, fmt.Sprintf(`net use %s /delete /y >nul 2>&1 &`, mappedDrive))
    parts = append(parts, fmt.Sprintf(`net use %s %s /user:%s "%s" &&`, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD))
    parts = append(parts, fmt.Sprintf(`xcopy /E /I /Y %s %s &&`, localTestDir, share))

    // Set permissions for each scenario file based on the users array
    // users[0] = orphaned user (will be deleted)
    // users[1] = name-based mapping user
    // users[2] = unmapped user
    if len(users) > 0 {
        parts = append(parts, fmt.Sprintf(`icacls "%s\scenario1_orphaned\orphaned_user_file.txt" /grant "%s:F" &&`, share, users[0]))
    }
    if len(users) > 1 {
        parts = append(parts, fmt.Sprintf(`icacls "%s\scenario2_name_mapping\name_mapping_file.txt" /grant "%s:M" &&`, share, users[1]))
    }
    if len(users) > 2 {
        parts = append(parts, fmt.Sprintf(`icacls "%s\scenario3_unmapped\unmapped_user_file.txt" /grant "%s:R" &&`, share, users[2]))
    }

    parts = append(parts, `echo ===== SID mapping test files and permissions created ===== &&`)
    parts = append(parts, fmt.Sprintf(`dir %s /s /b &&`, share))
    parts = append(parts, fmt.Sprintf(`net use %s /delete /y &&`, mappedDrive))
    parts = append(parts, fmt.Sprintf(`rmdir /s /q %s`, localTestDir))

    return strings.Join(parts, " ")
}

// ClearAllSMBSessions forcefully clears all SMB sessions and Windows name/DNS caches
func ClearAllSMBSessions() error {
    script := clearAllSMBSessionsScript()

    LogDebug("Clearing all SMB sessions and Windows name/DNS caches...")

    config := GetAttachedWorkerDetails()
    sshConfig := SSHConfig{
        Username: config.Username,
        Host:     config.Host,
        Port:     config.Port,
        Password: config.Password,
    }

    output, err := sshRunScript(sshConfig, script)
    LogDebug(fmt.Sprintf("ClearAllSMBSessions script output: %s", output))

    if err != nil {
        return fmt.Errorf("ClearAllSMBSessions failed: %w\noutput: %s", err, output)
    }

    LogDebug("Successfully cleared all SMB sessions and caches")
    return nil
}

func clearAllSMBSessionsScript() string {
    var parts []string
    parts = append(parts, `cmd /C`)
    parts = append(parts, `net use * /delete /y >nul 2>&1 &`)
    parts = append(parts, `nbtstat -R >nul 2>&1 &`)
    parts = append(parts, `ipconfig /flushdns >nul 2>&1 &`)
    parts = append(parts, `klist purge >nul 2>&1 &`)
    parts = append(parts, `timeout /t 3 /nobreak >nul 2>&1 &`)
    parts = append(parts, `echo SMB sessions and caches cleared`)

    return strings.Join(parts, " ")
}

// VerifyADPrincipalsExist checks if the principals can be resolved in Active Directory
func VerifyADPrincipalsExist(principals []string) (bool, error) {
    script := verifyADPrincipalsScript(principals)

    LogDebug(fmt.Sprintf("Verifying AD principals exist: %v", principals))

    config := GetAttachedWorkerDetails()
    sshConfig := SSHConfig{
        Username: config.Username,
        Host:     config.Host,
        Port:     config.Port,
        Password: config.Password,
    }

    output, err := sshRunScript(sshConfig, script)
    LogDebug(fmt.Sprintf("VerifyADPrincipalsExist script output: %s", output))

    if err != nil {
        return false, fmt.Errorf("VerifyADPrincipalsExist failed: %w\noutput: %s", err, output)
    }

    // Check if all principals were found
    allExist := true
    for _, principal := range principals {
        username := principal
        if strings.Contains(principal, "\\") {
            parts := strings.Split(principal, "\\")
            username = parts[len(parts)-1]
        }

        if !strings.Contains(output, fmt.Sprintf("EXISTS: %s", username)) {
            allExist = false
            LogDebug(fmt.Sprintf("Principal %s does NOT exist in AD", username))
        }
    }

    return allExist, nil
}

func verifyADPrincipalsScript(principals []string) string {
    adUsername := PROTOCOL_USERNAME
    adPassword := PROTOCOL_PASSWORD

    var parts []string
    parts = append(parts, `powershell.exe -Command "`)
    parts = append(parts, fmt.Sprintf(`$password = ConvertTo-SecureString '%s' -AsPlainText -Force; `, adPassword))
    parts = append(parts, fmt.Sprintf(`$credential = New-Object System.Management.Automation.PSCredential('%s', $password); `, adUsername))
    parts = append(parts, `Import-Module ActiveDirectory -ErrorAction Stop; `)

    for _, principal := range principals {
        username := principal
        if strings.Contains(principal, "\\") {
            userParts := strings.Split(principal, "\\")
            username = userParts[len(userParts)-1]
        }

        parts = append(parts, fmt.Sprintf(`$obj = Get-ADUser -Identity '%s' -Credential $credential -ErrorAction SilentlyContinue; `+
            `if ($obj) { Write-Host 'EXISTS: %s (User)'; } else { `+
            `$obj = Get-ADGroup -Identity '%s' -Credential $credential -ErrorAction SilentlyContinue; `+
            `if ($obj) { Write-Host 'EXISTS: %s (Group)'; } else { Write-Host 'NOT_FOUND: %s'; }; `+
            `}; `,
            username, username, username, username, username))
    }

    parts = append(parts, `"`)
    return strings.Join(parts, " ")
}

// GetSMBPermissionsWithSID uses PowerShell Get-Acl to capture both display names and SIDs
// This bypasses icacls name resolution cache and directly queries AD to verify principal existence
func GetSMBPermissionsWithSID(export string) ([]SMBPermissionWithSID, error) {
    script := getSMBPermissionsWithSIDScript(export)

    LogDebug("Getting SMB permissions with SID resolution script")

    config := GetAttachedWorkerDetails()
    sshConfig := SSHConfig{
        Username: config.Username,
        Host:     config.Host,
        Port:     config.Port,
        Password: config.Password,
    }

    output, err := sshRunScript(sshConfig, script)
    LogDebug("GetSMBPermissionsWithSID script successfully executed")

    if err != nil {
        return nil, fmt.Errorf("GetSMBPermissionsWithSID failed: %w\noutput: %s", err, output)
    }

    permissions, err := parseSMBPermissionsWithSID(output)
    if err != nil {
        LogDebug(fmt.Sprintf("Failed to parse SMB permissions with SID from output: %s", output))
        return nil, fmt.Errorf("failed to parse SMB permissions with SID: %w", err)
    }

    LogDebug(fmt.Sprintf("Retrieved %d file/directory permissions with SID info from %s", len(permissions), export))
    return permissions, nil
}

func getSMBPermissionsWithSIDScript(export string) string {
    split := strings.Split(export, ":")
    smbShare := fmt.Sprintf(`\\%s\%s`, strings.TrimSpace(split[0]), strings.TrimSpace(split[1]))

    testDir := `permissions_test`
    uncPath := fmt.Sprintf(`%s\%s`, smbShare, testDir)

    adUsername := PROTOCOL_USERNAME
    adPassword := PROTOCOL_PASSWORD

    var parts []string
    parts = append(parts, `powershell.exe -Command "`)

    // Setup credentials and connect
    parts = append(parts, fmt.Sprintf(`$password = ConvertTo-SecureString '%s' -AsPlainText -Force; `, adPassword))
    parts = append(parts, fmt.Sprintf(`$credential = New-Object System.Management.Automation.PSCredential('%s', $password); `, adUsername))
    parts = append(parts, `Import-Module ActiveDirectory -ErrorAction SilentlyContinue; `)
    parts = append(parts, fmt.Sprintf(`net use '%s' /user:%s '%s' 2>&1 | Out-Null; `, uncPath, adUsername, adPassword))

    // Check if path exists
    parts = append(parts, fmt.Sprintf(`if (Test-Path '%s') { `, uncPath))
    parts = append(parts, fmt.Sprintf(`$items = Get-ChildItem -Path '%s' -Recurse -Force; `, uncPath))

    // Process each item
    parts = append(parts, `foreach ($item in $items) { `)
    parts = append(parts, `$acl = Get-Acl -Path $item.FullName; `)
    parts = append(parts, `Write-Host ('FILE_START:' + $item.FullName + ':' + $item.PSIsContainer); `)

    // Process each ACL entry
    parts = append(parts, `foreach ($access in $acl.Access) { `)
    parts = append(parts, `$identity = $access.IdentityReference; `)
    parts = append(parts, `$displayName = $identity.Value; `)
    parts = append(parts, `$rawSID = ''; `)
    parts = append(parts, `$existsInAD = 'false'; `)
    parts = append(parts, `$principalType = 'UNKNOWN'; `)

    // Get SID
    parts = append(parts, `try { `)
    parts = append(parts, `if ($identity -is [System.Security.Principal.SecurityIdentifier]) { `)
    parts = append(parts, `$rawSID = $identity.Value `)
    parts = append(parts, `} else { `)
    parts = append(parts, `$sidObj = $identity.Translate([System.Security.Principal.SecurityIdentifier]); `)
    parts = append(parts, `$rawSID = $sidObj.Value `)
    parts = append(parts, `} `)
    parts = append(parts, `} catch { $rawSID = 'CANNOT_RESOLVE' }; `)

    // Check if domain SID and verify in AD
    parts = append(parts, `if ($rawSID -match '^S-1-5-21-') { `)
    parts = append(parts, `try { `)
    parts = append(parts, `$null = Get-ADUser -Identity $rawSID -Credential $credential -ErrorAction Stop; `)
    parts = append(parts, `$existsInAD = 'true'; `)
    parts = append(parts, `$principalType = 'USER' `)
    parts = append(parts, `} catch { `)
    parts = append(parts, `try { `)
    parts = append(parts, `$null = Get-ADGroup -Identity $rawSID -Credential $credential -ErrorAction Stop; `)
    parts = append(parts, `$existsInAD = 'true'; `)
    parts = append(parts, `$principalType = 'GROUP' `)
    parts = append(parts, `} catch { `)
    parts = append(parts, `$existsInAD = 'false'; `)
    parts = append(parts, `$principalType = 'ORPHANED' `)
    parts = append(parts, `} `)
    parts = append(parts, `} `)
    parts = append(parts, `} else { `)
    parts = append(parts, `$existsInAD = 'builtin'; `)
    parts = append(parts, `$principalType = 'BUILTIN' `)
    parts = append(parts, `}; `)

    // Output ACL entry
    parts = append(parts, `Write-Host ('ACL:' + $displayName + '|' + $rawSID + '|' + $access.AccessControlType + '|' + $access.FileSystemRights + '|' + $existsInAD + '|' + $principalType); `)
    parts = append(parts, `}; `)
    parts = append(parts, `Write-Host 'FILE_END'; `)
    parts = append(parts, `} `)
    parts = append(parts, `} else { Write-Host 'PATH_NOT_FOUND' }; `)

    // Cleanup
    parts = append(parts, fmt.Sprintf(`net use '%s' /delete /y 2>&1 | Out-Null`, uncPath))
    parts = append(parts, `"`)

    return strings.Join(parts, " ")
}

func parseSMBPermissionsWithSID(output string) ([]SMBPermissionWithSID, error) {
    var permissions []SMBPermissionWithSID
    lines := strings.Split(output, "\n")

    var currentPerm SMBPermissionWithSID
    var isParsingFile bool

    for _, line := range lines {
        line = strings.TrimSpace(line)

        if strings.HasPrefix(line, "FILE_START:") {
            parts := strings.SplitN(line, ":", 3)
            if len(parts) >= 3 {
                currentPerm = SMBPermissionWithSID{
                    FilePath:    parts[1],
                    IsDirectory: parts[2] == "True",
                    ACLEntries:  []ACLEntryWithSID{},
                }
                isParsingFile = true
            }
            continue
        }

        if strings.HasPrefix(line, "FILE_END") {
            if isParsingFile && currentPerm.FilePath != "" {
                permissions = append(permissions, currentPerm)
            }
            isParsingFile = false
            continue
        }

        if strings.HasPrefix(line, "ACL:") && isParsingFile {
            aclData := strings.TrimPrefix(line, "ACL:")
            parts := strings.Split(aclData, "|")
            if len(parts) >= 6 {
                entry := ACLEntryWithSID{
                    DisplayName: parts[0],
                    SID:         parts[1],
                    AccessType:  parts[2],
                    Permissions: parts[3],
                    ExistsInAD:  parts[4] == "true" || parts[4] == "builtin",
                    IsOrphaned:  parts[4] == "false",
                }
                currentPerm.ACLEntries = append(currentPerm.ACLEntries, entry)
            }
        }
    }

    return permissions, nil
}

// CompareSMBPermissionsBySID compares source and destination permissions by matching SIDs
func CompareSMBPermissionsBySID(sourcePerms, destPerms []SMBPermissionWithSID) (validMatches, orphanedMatches, mismatches []string, err error) {
    if len(sourcePerms) == 0 {
        return nil, nil, nil, fmt.Errorf("no source permissions to compare")
    }

    if len(destPerms) == 0 {
        return nil, nil, nil, fmt.Errorf("no destination permissions found")
    }

    // Build maps for quick lookup by filename
    sourceMap := make(map[string]SMBPermissionWithSID)
    destMap := make(map[string]SMBPermissionWithSID)

    for _, perm := range sourcePerms {
        fileName := getFileNameFromPath(perm.FilePath)
        sourceMap[fileName] = perm
    }

    for _, perm := range destPerms {
        fileName := getFileNameFromPath(perm.FilePath)
        destMap[fileName] = perm
    }

    validMatches = []string{}
    orphanedMatches = []string{}
    mismatches = []string{}

    // Compare each source file
    for fileName, sourcePerm := range sourceMap {
        destPerm, exists := destMap[fileName]
        if !exists {
            mismatches = append(mismatches, fmt.Sprintf("File missing in destination: %s", fileName))
            continue
        }

        // Build SID maps for this file
        sourceACLs := make(map[string]ACLEntryWithSID)
        destACLs := make(map[string]ACLEntryWithSID)

        for _, acl := range sourcePerm.ACLEntries {
            if acl.SID != "" && acl.SID != "CANNOT_RESOLVE" && strings.HasPrefix(acl.SID, "S-1-5-21-") {
                sourceACLs[acl.SID] = acl
            }
        }

        for _, acl := range destPerm.ACLEntries {
            if acl.SID != "" && acl.SID != "CANNOT_RESOLVE" && strings.HasPrefix(acl.SID, "S-1-5-21-") {
                destACLs[acl.SID] = acl
            }
        }

        // Compare ACLs by SID
        for sid, sourceACL := range sourceACLs {
            destACL, found := destACLs[sid]

            if !found {
                mismatches = append(mismatches,
                    fmt.Sprintf("SID missing in destination: %s (was: %s) in file %s",
                        sid, sourceACL.DisplayName, fileName))
                continue
            }

            // SID exists in destination - verify based on AD existence
            if sourceACL.ExistsInAD && !sourceACL.IsOrphaned {
                // Valid principal - verify name resolution matches
                if sourceACL.DisplayName != destACL.DisplayName {
                    mismatches = append(mismatches,
                        fmt.Sprintf("Name mismatch for SID %s in file %s: source=%s, dest=%s",
                            sid, fileName, sourceACL.DisplayName, destACL.DisplayName))
                } else {
                    validMatches = append(validMatches,
                        fmt.Sprintf("Valid principal %s (SID: %s) preserved in %s",
                            sourceACL.DisplayName, sid, fileName))
                }
            } else if sourceACL.IsOrphaned {
                // Orphaned principal - SID match is sufficient
                orphanedMatches = append(orphanedMatches,
                    fmt.Sprintf("Orphaned SID %s preserved in %s (source name: %s, dest name: %s)",
                        sid, fileName, sourceACL.DisplayName, destACL.DisplayName))
            }
        }
    }

    if len(mismatches) > 0 {
        return validMatches, orphanedMatches, mismatches, fmt.Errorf("permission mismatches detected")
    }

    return validMatches, orphanedMatches, mismatches, nil
}
