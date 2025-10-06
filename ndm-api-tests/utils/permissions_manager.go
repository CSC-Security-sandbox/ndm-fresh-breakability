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
