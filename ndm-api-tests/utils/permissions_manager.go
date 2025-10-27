package utils

import (
	"encoding/json"
	"fmt"
	"sort"
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
	Principal        string   `json:"principal"`
	AccessType       string   `json:"accessType"`
	Permissions      string   `json:"permissions"`
	InheritanceFlags []string `json:"inheritanceFlags"`
	PropagationFlags string   `json:"propagationFlags"`
}

// PowerShell Get-Acl JSON structures for parsing
type PowerShellACLResponse struct {
	Path        string                `json:"Path"`
	Owner       string                `json:"Owner"`
	IsDirectory bool                  `json:"IsDirectory"`
	Access      []PowerShellACLAccess `json:"Access"`
}

type PowerShellACLAccess struct {
	Principal        string `json:"Principal"`
	Rights           string `json:"Rights"`
	Type             string `json:"Type"`
	IsInherited      bool   `json:"IsInherited"`
	InheritanceFlags string `json:"InheritanceFlags"`
	PropagationFlags string `json:"PropagationFlags"`
}

// NormalizedACL represents a normalized ACL entry for comparison
type NormalizedACL struct {
	Principal   string
	Inheritance string // sorted, comma-separated inheritance flags
	Permission  string // canonical permission (FULL, MODIFY, READ, etc.)
}

// CreateSMBFilesWithDefaultPermissions creates test files with default/inherited permissions
//
// Directory Structure Created:
// ┌─────────────────────────────────────────────────────────────────────────────────┐
// │ Path                              │ Type      │ Permissions                      │
// ├───────────────────────────────────┼───────────┼──────────────────────────────────┤
// │ permissions_test/                 │ Directory │ Default (inherited from parent)  │
// │ permissions_test/file1.txt        │ File      │ Default (inherited from parent)  │
// │ permissions_test/file2.txt        │ File      │ Default (inherited from parent)  │
// │ permissions_test/file3.txt        │ File      │ Default (inherited from parent)  │
// │ permissions_test/subdir1/         │ Directory │ Default (inherited from parent)  │
// │ permissions_test/subdir1/subfile1.txt │ File  │ Default (inherited from parent)  │
// │ permissions_test/subdir2/         │ Directory │ Default (inherited from parent)  │
// │ permissions_test/subdir2/subfile2.txt │ File  │ Default (inherited from parent)  │
// └─────────────────────────────────────────────────────────────────────────────────┘
//
// Note: All files/directories inherit permissions from the SMB share parent directory.
// No explicit ACL modifications are applied.
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

	// PowerShell script to get ACLs in JSON format
	psScript := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
try { net use %s /delete /y *>$null } catch { }
net use %s %s /user:%s "%s" | Out-Null

if (Test-Path "%s") {
    $paths = @(
        "%s\file1.txt",
        "%s\file2.txt",
        "%s\file3.txt",
        "%s\subdir1\subfile1.txt",
        "%s\subdir2\subfile2.txt",
        "%s",
        "%s\subdir1",
        "%s\subdir2"
    )
    
    $results = @()
    foreach ($path in $paths) {
        if (Test-Path $path) {
            $acl = Get-Acl $path
            $isDir = (Get-Item $path) -is [System.IO.DirectoryInfo]
            
            $obj = [PSCustomObject]@{
                Path = $path
                Owner = $acl.Owner
                IsDirectory = $isDir
                Access = @($acl.Access | ForEach-Object {
                    [PSCustomObject]@{
                        Principal = $_.IdentityReference.Value
                        Rights = $_.FileSystemRights.ToString()
                        Type = $_.AccessControlType.ToString()
                        IsInherited = $_.IsInherited
                        InheritanceFlags = $_.InheritanceFlags.ToString()
                        PropagationFlags = $_.PropagationFlags.ToString()
                    }
                })
            }
            $results += $obj
        }
    }
    
    $results | ConvertTo-Json -Depth 10
} else {
    Write-Output "Test directory does not exist: %s"
}

net use %s /delete /y >$null 2>&1
`, mappedDrive, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD,
		share, share, share, share, share, share, share, share, share, share, mappedDrive)

	// Encode PowerShell script in Base64 to avoid quoting issues
	return fmt.Sprintf(`powershell.exe -NoProfile -NonInteractive -EncodedCommand "%s"`, encodePowerShellCommand(psScript))
}

// Helper function to encode PowerShell command in Base64
func encodePowerShellCommand(script string) string {
	// PowerShell expects UTF-16LE encoding for -EncodedCommand
	utf16 := encodeUTF16LE(script)
	return base64Encode(utf16)
}

func encodeUTF16LE(s string) []byte {
	runes := []rune(s)
	bytes := make([]byte, len(runes)*2)
	for i, r := range runes {
		bytes[i*2] = byte(r)
		bytes[i*2+1] = byte(r >> 8)
	}
	return bytes
}

func base64Encode(data []byte) string {
	const base64Table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	encoded := make([]byte, (len(data)+2)/3*4)

	for i, j := 0, 0; i < len(data); i, j = i+3, j+4 {
		b := uint32(data[i]) << 16
		if i+1 < len(data) {
			b |= uint32(data[i+1]) << 8
		}
		if i+2 < len(data) {
			b |= uint32(data[i+2])
		}

		encoded[j] = base64Table[(b>>18)&0x3F]
		encoded[j+1] = base64Table[(b>>12)&0x3F]
		if i+1 < len(data) {
			encoded[j+2] = base64Table[(b>>6)&0x3F]
		} else {
			encoded[j+2] = '='
		}
		if i+2 < len(data) {
			encoded[j+3] = base64Table[b&0x3F]
		} else {
			encoded[j+3] = '='
		}
	}

	return string(encoded)
}

func parseSMBPermissions(output string) ([]SMBFilePermission, error) {
	// Parse PowerShell Get-Acl JSON output
	// The output might contain extra text before/after JSON, so we need to extract it
	permissions, err := tryParsePowerShellJSON(output)
	if err == nil && len(permissions) > 0 {
		LogDebug("Successfully parsed PowerShell JSON output")
		return permissions, nil
	}

	// If parsing fails, return the error
	return nil, fmt.Errorf("failed to parse PowerShell JSON output: %w", err)
}

// tryParsePowerShellJSON attempts to extract and parse PowerShell JSON from the output
func tryParsePowerShellJSON(output string) ([]SMBFilePermission, error) {
	// Clean up the output and find JSON array or object
	output = strings.TrimSpace(output)

	// Find the start of JSON (either [ or {)
	jsonStart := strings.Index(output, "[")
	if jsonStart == -1 {
		jsonStart = strings.Index(output, "{")
		if jsonStart == -1 {
			return nil, fmt.Errorf("no JSON found in output")
		}
	}

	// Extract everything from the JSON start
	jsonOutput := output[jsonStart:]

	// Try to find the end of JSON by counting brackets
	jsonEnd := findJSONEnd(jsonOutput)
	if jsonEnd > 0 {
		jsonOutput = jsonOutput[:jsonEnd]
	}

	LogDebug(fmt.Sprintf("Attempting to parse JSON output (length: %d)", len(jsonOutput)))

	// Try to parse as array first (multiple files)
	var psACLs []PowerShellACLResponse
	err := json.Unmarshal([]byte(jsonOutput), &psACLs)
	if err == nil {
		LogDebug(fmt.Sprintf("Successfully parsed %d ACL entries from JSON array", len(psACLs)))
		return convertPowerShellACLsToSMBPermissions(psACLs), nil
	}

	LogDebug(fmt.Sprintf("Failed to parse as array: %v", err))

	// Only try to parse as single object if the error suggests it's not an array
	// Check if the error is a type error indicating it's actually an array
	if jsonTypeErr, ok := err.(*json.UnmarshalTypeError); ok && jsonTypeErr.Value == "array" {
		// The JSON is an array but parsing failed for structural reasons
		LogDebug(fmt.Sprintf("JSON is an array but has structural issues. Raw JSON: %s", jsonOutput))
		return nil, fmt.Errorf("failed to parse JSON array structure: %w", err)
	}

	// Try to parse as single object (only if it's not an array)
	var psACL PowerShellACLResponse
	err2 := json.Unmarshal([]byte(jsonOutput), &psACL)
	if err2 != nil {
		LogDebug(fmt.Sprintf("Failed to parse as single object: %v", err2))
		LogDebug(fmt.Sprintf("JSON content: %s", jsonOutput))
		return nil, fmt.Errorf("failed to parse JSON as array (%w) or single object (%v)", err, err2)
	}

	psACLs = []PowerShellACLResponse{psACL}
	LogDebug("Successfully parsed 1 ACL entry from JSON object")
	return convertPowerShellACLsToSMBPermissions(psACLs), nil
}

// findJSONEnd finds the end of a JSON structure by counting brackets
func findJSONEnd(jsonStr string) int {
	if len(jsonStr) == 0 {
		return -1
	}

	depth := 0
	inString := false
	escapeNext := false
	startChar := jsonStr[0]
	var endChar byte

	if startChar == '[' {
		endChar = ']'
	} else if startChar == '{' {
		endChar = '}'
	} else {
		return -1
	}

	for i, char := range jsonStr {
		if escapeNext {
			escapeNext = false
			continue
		}

		if char == '\\' {
			escapeNext = true
			continue
		}

		if char == '"' {
			inString = !inString
			continue
		}

		if inString {
			continue
		}

		if char == rune(startChar) || char == '{' || char == '[' {
			depth++
		} else if char == rune(endChar) || char == '}' || char == ']' {
			depth--
			if depth == 0 {
				return i + 1
			}
		}
	}

	return -1
}

// convertPowerShellACLsToSMBPermissions converts PowerShell Get-Acl JSON to SMBFilePermission
func convertPowerShellACLsToSMBPermissions(psACLs []PowerShellACLResponse) []SMBFilePermission {
	var permissions []SMBFilePermission

	for _, psACL := range psACLs {
		perm := SMBFilePermission{
			FilePath:    psACL.Path,
			Owner:       psACL.Owner,
			Permissions: make(map[string]string),
			ACLEntries:  []ACLEntry{},
			IsDirectory: psACL.IsDirectory,
		}

		// Convert PowerShell ACL entries to our ACLEntry format
		for _, access := range psACL.Access {
			// Parse inheritance flags from string like "None" or "ContainerInherit, ObjectInherit"
			inheritFlags := parseInheritanceFlagsFromString(access.InheritanceFlags)

			aclEntry := ACLEntry{
				Principal:        access.Principal,
				AccessType:       access.Type,
				Permissions:      access.Rights,
				InheritanceFlags: inheritFlags,
				PropagationFlags: access.PropagationFlags,
			}

			perm.ACLEntries = append(perm.ACLEntries, aclEntry)

			// Store raw permissions for backward compatibility
			inheritanceStr := strings.Join(inheritFlags, "")
			perm.Permissions[access.Principal] = fmt.Sprintf("(%s)(%s)", inheritanceStr, access.Rights)
		}

		permissions = append(permissions, perm)
	}

	return permissions
}

// parseInheritanceFlagsFromString parses "ContainerInherit, ObjectInherit" to ["CI", "OI"]
func parseInheritanceFlagsFromString(flagsStr string) []string {
	if flagsStr == "" || flagsStr == "None" {
		return []string{}
	}

	var flags []string
	parts := strings.Split(flagsStr, ",")

	for _, part := range parts {
		part = strings.TrimSpace(part)
		switch part {
		case "ContainerInherit":
			flags = append(flags, "CI")
		case "ObjectInherit":
			flags = append(flags, "OI")
		case "InheritOnly":
			flags = append(flags, "IO")
		case "NoPropagateInherit":
			flags = append(flags, "NP")
		}
	}

	return flags
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

		// Normalize ACLs for comparison
		sourceNormalized := normalizeACLs(sourcePerm.ACLEntries)
		destNormalized := normalizeACLs(destPerm.ACLEntries)

		// Compare ACL counts
		if len(sourceNormalized) != len(destNormalized) {
			LogDebug(fmt.Sprintf("ACL count mismatch for %s: source has %d ACLs, dest has %d ACLs",
				fileName, len(sourceNormalized), len(destNormalized)))
			LogDebug(fmt.Sprintf("Source ACLs: %+v", sourceNormalized))
			LogDebug(fmt.Sprintf("Dest ACLs: %+v", destNormalized))
		}

		// Check all source ACLs exist in destination
		for _, srcACL := range sourceNormalized {
			found := false
			for _, dstACL := range destNormalized {
				if compareNormalizedACLs(srcACL, dstACL, sourcePerm.IsDirectory) {
					found = true
					break
				}
			}
			if !found {
				permissionMismatches = append(permissionMismatches,
					fmt.Sprintf("Source ACL not found in dest for %s: %s:%s(%s)",
						fileName, srcACL.Principal, srcACL.Inheritance, srcACL.Permission))
			}
		}

		// Check all dest ACLs exist in source (no extras allowed)
		for _, dstACL := range destNormalized {
			found := false
			for _, srcACL := range sourceNormalized {
				if compareNormalizedACLs(srcACL, dstACL, sourcePerm.IsDirectory) {
					found = true
					break
				}
			}
			if !found {
				permissionMismatches = append(permissionMismatches,
					fmt.Sprintf("Extra ACL in dest (not in source) for %s: %s:%s(%s)",
						fileName, dstACL.Principal, dstACL.Inheritance, dstACL.Permission))
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

	LogDebug("SMB permissions comparison completed - all permissions preserved")
	return nil
}

// normalizeACLs normalizes a list of ACL entries for comparison
func normalizeACLs(acls []ACLEntry) []NormalizedACL {
	var normalized []NormalizedACL

	for _, acl := range acls {
		// Sort inheritance flags for consistent comparison
		sortedFlags := make([]string, len(acl.InheritanceFlags))
		copy(sortedFlags, acl.InheritanceFlags)
		sort.Strings(sortedFlags)

		normalized = append(normalized, NormalizedACL{
			Principal:   normalizePrincipal(acl.Principal),
			Inheritance: strings.Join(sortedFlags, ","),
			Permission:  normalizePermission(acl.Permissions),
		})
	}

	return normalized
}

// compareNormalizedACLs compares two normalized ACLs considering inheritance-related equivalence
func compareNormalizedACLs(src, dst NormalizedACL, isDirectory bool) bool {
	// Principal must match
	if src.Principal != dst.Principal {
		return false
	}

	// Permission must match (with equivalence like GA = F = FULL)
	if !arePermissionsEquivalent(src.Permission, dst.Permission) {
		return false
	}

	// Inheritance flags must match (with some tolerance for inherited ACLs)
	return areInheritanceFlagsEquivalent(src.Inheritance, dst.Inheritance, isDirectory)
}

// arePermissionsEquivalent checks if two permissions are equivalent
func arePermissionsEquivalent(perm1, perm2 string) bool {
	perm1 = strings.ToUpper(strings.TrimSpace(perm1))
	perm2 = strings.ToUpper(strings.TrimSpace(perm2))

	if perm1 == perm2 {
		return true
	}

	// Map all variations to canonical forms
	canonical1 := normalizePermission(perm1)
	canonical2 := normalizePermission(perm2)

	return canonical1 == canonical2
}

// areInheritanceFlagsEquivalent checks if inheritance flags are equivalent
// Only allows specific inheritance-related differences for directories:
// - Adding (I) flag (inherited from parent)
// - Adding (OI) and/or (CI) flags (object/container inherit for folders)
func areInheritanceFlagsEquivalent(flags1, flags2 string, isDirectory bool) bool {
	// Exact match is always OK
	if flags1 == flags2 {
		return true
	}

	// For files (not directories), inheritance flags must match exactly
	if !isDirectory {
		return false
	}

	// For directories, check if the difference is only in acceptable inheritance flags
	f1 := strings.Split(flags1, ",")
	f2 := strings.Split(flags2, ",")

	// Remove empty strings
	f1Clean := removeEmpty(f1)
	f2Clean := removeEmpty(f2)

	// Create sets for comparison
	f1Set := make(map[string]bool)
	f2Set := make(map[string]bool)
	for _, flag := range f1Clean {
		f1Set[flag] = true
	}
	for _, flag := range f2Clean {
		f2Set[flag] = true
	}

	// Find flags only in f1 and only in f2
	onlyInF1 := []string{}
	onlyInF2 := []string{}

	for flag := range f1Set {
		if !f2Set[flag] {
			onlyInF1 = append(onlyInF1, flag)
		}
	}
	for flag := range f2Set {
		if !f1Set[flag] {
			onlyInF2 = append(onlyInF2, flag)
		}
	}

	// If no differences, they're equal (already handled above, but for clarity)
	if len(onlyInF1) == 0 && len(onlyInF2) == 0 {
		return true
	}

	// Only allow differences in these inheritance flags for directories
	allowedDifferences := map[string]bool{
		"I":  true, // Inherited from parent
		"OI": true, // Object inherit (files in folder)
		"CI": true, // Container inherit (subfolders)
	}

	// Check if all differences are in allowed flags
	for _, flag := range onlyInF1 {
		if !allowedDifferences[flag] {
			return false
		}
	}
	for _, flag := range onlyInF2 {
		if !allowedDifferences[flag] {
			return false
		}
	}

	// All differences are acceptable inheritance flags
	return true
}

// removeEmpty removes empty strings from a slice
func removeEmpty(s []string) []string {
	var result []string
	for _, str := range s {
		if str != "" {
			result = append(result, str)
		}
	}
	return result
}

// normalizePermission maps all permission variations to canonical names
func normalizePermission(perm string) string {
	perm = strings.ToUpper(strings.TrimSpace(perm))

	// Handle numeric FileSystemRights values
	// These are common bitmask values that represent the same effective permissions
	switch perm {
	// Full Control variations
	// 268435456 = 0x10000000 = GENERIC_ALL (maps to Full Control)
	// 270467583 = 0x101F01FF = GENERIC_ALL + FILE_ALL_ACCESS (Full Control with expanded rights)
	case "GA", "F", "FULL", "FULL CONTROL", "FULLCONTROL", "2032127", "-536805376",
		"268435456", "270467583":
		return "FULL"
	// Modify variations
	case "M", "MODIFY", "1245631", "1180095":
		return "MODIFY"
	// Read & Execute variations (including numeric representations)
	case "RX", "READ", "READ & EXECUTE", "READ AND EXECUTE", "READANDEXECUTE",
		"131209", "131241":
		return "READ"
	// Write variations
	case "W", "WRITE", "278", "536870912":
		return "WRITE"
	// Read-only (same as READ above, kept for clarity)
	case "R", "READONLY":
		return "READ"
	// ListDirectory
	case "LD", "LISTDIRECTORY", "1":
		return "READ"
	// Execute
	case "X", "EXECUTE", "1073741824":
		return "EXECUTE"
	default:
		return perm
	}
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

// GetSMBPermissionsWithPowerShell uses PowerShell Get-Acl to retrieve permissions
// This approach uses SSH to run PowerShell commands on the remote Windows worker
func GetSMBPermissionsWithPowerShell(export string, paths []string) ([]SMBFilePermission, error) {
	split := strings.Split(export, ":")
	smbShare := fmt.Sprintf(`\\%s\%s`, strings.TrimSpace(split[0]), strings.TrimSpace(split[1]))

	mappedDrive := `Z:`

	// Build PowerShell path list
	pathList := ""
	for i, path := range paths {
		if i > 0 {
			pathList += ","
		}
		pathList += fmt.Sprintf(`"%s"`, path)
	}

	psScript := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
try { net use %s /delete /y *>$null } catch { }
net use %s %s /user:%s "%s" | Out-Null

$paths = @(%s)
$results = @()

foreach ($path in $paths) {
    if (Test-Path $path) {
        $acl = Get-Acl $path
        $isDir = (Get-Item $path) -is [System.IO.DirectoryInfo]
        
        $obj = [PSCustomObject]@{
            Path = $path
            Owner = $acl.Owner
            IsDirectory = $isDir
            Access = @($acl.Access | ForEach-Object {
                [PSCustomObject]@{
                    Principal = $_.IdentityReference.Value
                    Rights = $_.FileSystemRights.ToString()
                    Type = $_.AccessControlType.ToString()
                    IsInherited = $_.IsInherited
                    InheritanceFlags = $_.InheritanceFlags.ToString()
                    PropagationFlags = $_.PropagationFlags.ToString()
                }
            })
        }
        $results += $obj
    }
}

$results | ConvertTo-Json -Depth 10
net use %s /delete /y >$null 2>&1
`, mappedDrive, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD, pathList, mappedDrive)

	config := GetAttachedWorkerDetails()
	sshConfig := SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
	}

	command := fmt.Sprintf(`powershell.exe -NoProfile -NonInteractive -EncodedCommand "%s"`, encodePowerShellCommand(psScript))
	output, err := sshRunScript(sshConfig, command)

	if err != nil {
		LogDebug(fmt.Sprintf("Failed to get PowerShell ACLs: %v", err))
		return nil, fmt.Errorf("failed to get ACLs via PowerShell: %w", err)
	}

	// Parse JSON output
	var psACLs []PowerShellACLResponse
	if err := json.Unmarshal([]byte(output), &psACLs); err != nil {
		LogDebug(fmt.Sprintf("Failed to parse PowerShell JSON output: %v\nOutput: %s", err, output))
		return nil, fmt.Errorf("failed to parse PowerShell JSON: %w", err)
	}

	return convertPowerShellACLsToSMBPermissions(psACLs), nil
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

// CreateSMBFilesWithMultiplePermissions creates test files with explicit permission levels
//
// Directory Structure Created:
// ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
// │ Path                                            │ Type      │ Permissions Applied                │
// ├─────────────────────────────────────────────────┼───────────┼────────────────────────────────────┤
// │ permissions_test/                               │ Directory │ Default                            │
// │ permissions_test/root_file.txt                  │ File      │ Everyone: Modify                   │
// ├─────────────────────────────────────────────────┼───────────┼────────────────────────────────────┤
// │ permissions_test/full_access_dir/               │ Directory │ Everyone: Full Control (OI)(CI)    │
// │ permissions_test/full_access_dir/full_file.txt  │ File      │ Everyone: Full Control             │
// ├─────────────────────────────────────────────────┼───────────┼────────────────────────────────────┤
// │ permissions_test/read_only_dir/                 │ Directory │ Everyone: Read (OI)(CI)            │
// │ permissions_test/read_only_dir/readonly_file.txt│ File      │ Everyone: Read                     │
// ├─────────────────────────────────────────────────┼───────────┼────────────────────────────────────┤
// │ permissions_test/write_only_dir/                │ Directory │ Everyone: Write (OI)(CI)           │
// │ permissions_test/write_only_dir/write_file.txt  │ File      │ Everyone: Write                    │
// ├─────────────────────────────────────────────────┼───────────┼────────────────────────────────────┤
// │ permissions_test/modify_dir/                    │ Directory │ Everyone: Modify (OI)(CI)          │
// │ permissions_test/modify_dir/modify_file.txt     │ File      │ Everyone: Modify                   │
// ├─────────────────────────────────────────────────┼───────────┼────────────────────────────────────┤
// │ permissions_test/execute_dir/                   │ Directory │ Everyone: Read & Execute (OI)(CI)  │
// │ permissions_test/execute_dir/execute_file.txt   │ File      │ Everyone: Read & Execute           │
// ├─────────────────────────────────────────────────┼───────────┼────────────────────────────────────┤
// │ permissions_test/mixed_permissions_dir/         │ Directory │ Authenticated Users: Modify (OI)(CI)│
// │                                                 │           │ BUILTIN\Users: Read & Execute (OI)(CI)│
// │                                                 │           │ BUILTIN\Administrators: Full (OI)(CI) │
// │ permissions_test/mixed_permissions_dir/mixed_file1.txt │ File │ BUILTIN\Administrators: Full    │
// │                                                 │           │ BUILTIN\Users: Read                │
// │ permissions_test/mixed_permissions_dir/mixed_file2.txt │ File │ Authenticated Users: Modify     │
// ├─────────────────────────────────────────────────┼───────────┼────────────────────────────────────┤
// │ permissions_test/mixed_permissions_dir/subdir1/ │ Directory │ Everyone: Modify (OI)(CI)          │
// │ permissions_test/mixed_permissions_dir/subdir1/subfile1.txt │ File │ Inherited from parent      │
// ├─────────────────────────────────────────────────┼───────────┼────────────────────────────────────┤
// │ permissions_test/mixed_permissions_dir/subdir2/ │ Directory │ Everyone: Read (OI)(CI)            │
// │ permissions_test/mixed_permissions_dir/subdir2/subfile2.txt │ File │ Inherited from parent      │
// └──────────────────────────────────────────────────────────────────────────────────────────────────┘
//
// Legend:
//
//	OI = ObjectInherit (files inherit this permission)
//	CI = ContainerInherit (subdirectories inherit this permission)
//
// Note: This function creates a comprehensive test structure to validate various
// permission levels and inheritance behaviors in SMB file migrations.
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

	// PowerShell script to get comprehensive ACLs in JSON format
	psScript := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
try { net use %s /delete /y *>$null } catch { }
net use %s %s /user:%s "%s" | Out-Null

if (Test-Path "%s") {
    $paths = @(
        "%s\full_access_dir\full_file.txt",
        "%s\read_only_dir\readonly_file.txt",
        "%s\write_only_dir\write_file.txt",
        "%s\modify_dir\modify_file.txt",
        "%s\execute_dir\execute_file.txt",
        "%s\mixed_permissions_dir\mixed_file1.txt",
        "%s\mixed_permissions_dir\mixed_file2.txt",
        "%s\mixed_permissions_dir\subdir1\subfile1.txt",
        "%s\mixed_permissions_dir\subdir2\subfile2.txt",
        "%s\root_file.txt",
        "%s",
        "%s\full_access_dir",
        "%s\read_only_dir",
        "%s\write_only_dir",
        "%s\modify_dir",
        "%s\execute_dir",
        "%s\mixed_permissions_dir",
        "%s\mixed_permissions_dir\subdir1",
        "%s\mixed_permissions_dir\subdir2"
    )
    
    $results = @()
    foreach ($path in $paths) {
        if (Test-Path $path) {
            $acl = Get-Acl $path
            $isDir = (Get-Item $path) -is [System.IO.DirectoryInfo]
            
            $obj = [PSCustomObject]@{
                Path = $path
                Owner = $acl.Owner
                IsDirectory = $isDir
                Access = @($acl.Access | ForEach-Object {
                    [PSCustomObject]@{
                        Principal = $_.IdentityReference.Value
                        Rights = $_.FileSystemRights.ToString()
                        Type = $_.AccessControlType.ToString()
                        IsInherited = $_.IsInherited
                        InheritanceFlags = $_.InheritanceFlags.ToString()
                        PropagationFlags = $_.PropagationFlags.ToString()
                    }
                })
            }
            $results += $obj
        }
    }
    
    $results | ConvertTo-Json -Depth 10
} else {
    Write-Output "Test directory does not exist: %s"
}

net use %s /delete /y >$null 2>&1
`, mappedDrive, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD,
		share, share, share, share, share, share, share, share, share, share, share,
		share, share, share, share, share, share, share, share, share, share, mappedDrive)

	// Encode PowerShell script in Base64 to avoid quoting issues
	return fmt.Sprintf(`powershell.exe -NoProfile -NonInteractive -EncodedCommand "%s"`, encodePowerShellCommand(psScript))
}
