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

	testDir := `permissions_test`
	mappedDrive := `Z:`
	share := fmt.Sprintf(`%s\%s`, mappedDrive, testDir)

	var parts []string
	parts = append(parts, `cmd /C`)
	// Map SMB share
	parts = append(parts, fmt.Sprintf(`net use %s /delete /y >nul 2>&1 &`, mappedDrive))
	parts = append(parts, fmt.Sprintf(`net use %s %s /user:%s "%s" &&`, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD))
	// Clean up existing permissions_test directory if it exists
	parts = append(parts, fmt.Sprintf(`(if exist %s ( rmdir /s /q %s ) else ( echo "permissions_test not found" )) &`, share, share))
	// Create directories DIRECTLY on SMB share (not local copy)
	parts = append(parts, fmt.Sprintf(`mkdir %s &&`, share))
	parts = append(parts, fmt.Sprintf(`mkdir %s\subdir1 &&`, share))
	parts = append(parts, fmt.Sprintf(`mkdir %s\subdir2 &&`, share))
	// Create files DIRECTLY on SMB share (inherits share's default ACLs)
	parts = append(parts, fmt.Sprintf(`echo This is a test file with default permissions > %s\file1.txt &&`, share))
	parts = append(parts, fmt.Sprintf(`echo This is another test file with default permissions > %s\file2.txt &&`, share))
	parts = append(parts, fmt.Sprintf(`echo This is a third test file with default permissions > %s\file3.txt &&`, share))
	parts = append(parts, fmt.Sprintf(`echo This is a subdirectory file 1 > %s\subdir1\subfile1.txt &&`, share))
	parts = append(parts, fmt.Sprintf(`echo This is a subdirectory file 2 > %s\subdir2\subfile2.txt &&`, share))
	// Verify files created
	parts = append(parts, `echo Verifying files created on SMB share... &&`)
	parts = append(parts, fmt.Sprintf(`dir %s /s /b &&`, share))
	// Unmap drive
	parts = append(parts, fmt.Sprintf(`net use %s /delete /y`, mappedDrive))

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
            
            $accessList = @()
            if ($acl.Access -ne $null) {
                $accessList = @($acl.Access | ForEach-Object {
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
            
            $obj = [PSCustomObject]@{
                Path = $path
                Owner = $acl.Owner
                IsDirectory = $isDir
                Access = $accessList
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
        
        $accessList = @()
        if ($acl.Access -ne $null) {
            $accessList = @($acl.Access | ForEach-Object {
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
        
        $obj = [PSCustomObject]@{
            Path = $path
            Owner = $acl.Owner
            IsDirectory = $isDir
            Access = $accessList
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
            
            $accessList = @()
            if ($acl.Access -ne $null) {
                $accessList = @($acl.Access | ForEach-Object {
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
            
            $obj = [PSCustomObject]@{
                Path = $path
                Owner = $acl.Owner
                IsDirectory = $isDir
                Access = $accessList
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

	// Use PowerShell with domain credentials and SID pre-resolution (same approach as CreateSMBFilesForSIDMapping)
	script := fmt.Sprintf(`powershell.exe -Command "$password = ConvertTo-SecureString '%s' -AsPlainText -Force; `, PROTOCOL_PASSWORD)
	script += fmt.Sprintf(`$credential = New-Object System.Management.Automation.PSCredential('%s', $password); `, PROTOCOL_USERNAME)

	// Create local directory structure
	script += `$localDir = 'C:\permissions_test'; `
	script += `if (Test-Path $localDir) { Remove-Item -Recurse -Force $localDir }; `
	script += `New-Item -ItemType Directory -Path $localDir | Out-Null; `
	script += `New-Item -ItemType Directory -Path $localDir\valid_principals | Out-Null; `
	script += `New-Item -ItemType Directory -Path $localDir\invalid_principals | Out-Null; `
	script += `New-Item -ItemType Directory -Path $localDir\mixed_principals | Out-Null; `

	// Create test files
	script += `'Valid user 1 file' | Out-File -FilePath $localDir\valid_principals\valid_user1_file.txt; `
	script += `'Valid user 2 file' | Out-File -FilePath $localDir\valid_principals\valid_user2_file.txt; `
	script += `'Valid group file' | Out-File -FilePath $localDir\valid_principals\valid_group_file.txt; `
	script += `'Invalid user 1 file' | Out-File -FilePath $localDir\invalid_principals\invalid_user1_file.txt; `
	script += `'Invalid user 2 file' | Out-File -FilePath $localDir\invalid_principals\invalid_user2_file.txt; `
	script += `'Invalid group file' | Out-File -FilePath $localDir\invalid_principals\invalid_group_file.txt; `
	script += `'Mixed file' | Out-File -FilePath $localDir\mixed_principals\mixed_file.txt; `

	// Map SMB share
	script += `net use Z: /delete /y 2>&1 | Out-Null; `
	script += fmt.Sprintf(`$netUseResult = net use Z: %s /user:%s '%s' 2>&1; `, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD)
	script += `if ($LASTEXITCODE -ne 0) { throw "Failed to map drive: $netUseResult" }; `

	// Copy files to SMB share
	script += fmt.Sprintf(`$remotePath = '%s\permissions_test'; `, smbShare)
	script += `if (Test-Path $remotePath) { Remove-Item -Recurse -Force $remotePath }; `
	script += `New-Item -ItemType Directory -Path $remotePath -Force | Out-Null; `
	script += `Copy-Item -Recurse -Force $localDir\* $remotePath; `

	script += `Write-Host 'Applying permissions with SID pre-resolution...'; `

	// Apply permissions for valid users using SID pre-resolution
	if len(validUsers) > 0 {
		username1 := strings.Split(validUsers[0], `\`)[1]
		script += fmt.Sprintf(`try { $user1 = Get-ADUser -Identity '%s' -Credential $credential; `, username1)
		script += `$sid1 = New-Object System.Security.Principal.SecurityIdentifier($user1.SID); `
		script += fmt.Sprintf(`$path1 = '%s\permissions_test\valid_principals\valid_user1_file.txt'; `, smbShare)
		script += `$acl1 = Get-Acl $path1; $acl1.SetAccessRuleProtection($true, $true); `
		script += `$rule1 = New-Object System.Security.AccessControl.FileSystemAccessRule($sid1, 'FullControl', 'Allow'); `
		script += `$acl1.AddAccessRule($rule1); Set-Acl -Path $path1 -AclObject $acl1 -ErrorAction Stop; `
		script += fmt.Sprintf(`Write-Host 'Applied permissions for %s'; `, validUsers[0])
		script += `} catch { Write-Host 'ERROR:' $_; throw; }; `

		if len(validUsers) > 1 {
			username2 := strings.Split(validUsers[1], `\`)[1]
			script += fmt.Sprintf(`try { $user2 = Get-ADUser -Identity '%s' -Credential $credential; `, username2)
			script += `$sid2 = New-Object System.Security.Principal.SecurityIdentifier($user2.SID); `
			script += fmt.Sprintf(`$path2 = '%s\permissions_test\valid_principals\valid_user2_file.txt'; `, smbShare)
			script += `$acl2 = Get-Acl $path2; $acl2.SetAccessRuleProtection($true, $true); `
			script += `$rule2 = New-Object System.Security.AccessControl.FileSystemAccessRule($sid2, 'Modify', 'Allow'); `
			script += `$acl2.AddAccessRule($rule2); Set-Acl -Path $path2 -AclObject $acl2 -ErrorAction Stop; `
			script += fmt.Sprintf(`Write-Host 'Applied permissions for %s'; `, validUsers[1])
			script += `} catch { Write-Host 'ERROR:' $_; throw; }; `
		}
	}

	// Apply permissions for valid groups using Get-ADObject
	if len(validGroups) > 0 {
		groupname := strings.Split(validGroups[0], `\`)[1]
		script += fmt.Sprintf(`try { $group1 = Get-ADObject -Filter {SamAccountName -eq '%s'} -Properties ObjectSID -Credential $credential; `, groupname)
		script += `$sidg1 = $group1.ObjectSID; `
		script += fmt.Sprintf(`$pathg1 = '%s\permissions_test\valid_principals\valid_group_file.txt'; `, smbShare)
		script += `$aclg1 = Get-Acl $pathg1; $aclg1.SetAccessRuleProtection($true, $true); `
		script += `$ruleg1 = New-Object System.Security.AccessControl.FileSystemAccessRule($sidg1, 'Modify', 'Allow'); `
		script += `$aclg1.AddAccessRule($ruleg1); Set-Acl -Path $pathg1 -AclObject $aclg1 -ErrorAction Stop; `
		script += fmt.Sprintf(`Write-Host 'Applied permissions for %s'; `, validGroups[0])
		script += `} catch { Write-Host 'ERROR:' $_; throw; }; `
	}

	// Apply permissions for invalid users using SID pre-resolution
	if len(invalidUsers) > 0 {
		username1 := strings.Split(invalidUsers[0], `\`)[1]
		script += fmt.Sprintf(`try { $iuser1 = Get-ADUser -Identity '%s' -Credential $credential; `, username1)
		script += `$isid1 = New-Object System.Security.Principal.SecurityIdentifier($iuser1.SID); `
		script += fmt.Sprintf(`$ipath1 = '%s\permissions_test\invalid_principals\invalid_user1_file.txt'; `, smbShare)
		script += `$iacl1 = Get-Acl $ipath1; $iacl1.SetAccessRuleProtection($true, $true); `
		script += `$irule1 = New-Object System.Security.AccessControl.FileSystemAccessRule($isid1, 'FullControl', 'Allow'); `
		script += `$iacl1.AddAccessRule($irule1); Set-Acl -Path $ipath1 -AclObject $iacl1 -ErrorAction Stop; `
		script += fmt.Sprintf(`Write-Host 'Applied permissions for %s'; `, invalidUsers[0])
		script += `} catch { Write-Host 'ERROR:' $_; throw; }; `

		if len(invalidUsers) > 1 {
			username2 := strings.Split(invalidUsers[1], `\`)[1]
			script += fmt.Sprintf(`try { $iuser2 = Get-ADUser -Identity '%s' -Credential $credential; `, username2)
			script += `$isid2 = New-Object System.Security.Principal.SecurityIdentifier($iuser2.SID); `
			script += fmt.Sprintf(`$ipath2 = '%s\permissions_test\invalid_principals\invalid_user2_file.txt'; `, smbShare)
			script += `$iacl2 = Get-Acl $ipath2; $iacl2.SetAccessRuleProtection($true, $true); `
			script += `$irule2 = New-Object System.Security.AccessControl.FileSystemAccessRule($isid2, 'Modify', 'Allow'); `
			script += `$iacl2.AddAccessRule($irule2); Set-Acl -Path $ipath2 -AclObject $iacl2 -ErrorAction Stop; `
			script += fmt.Sprintf(`Write-Host 'Applied permissions for %s'; `, invalidUsers[1])
			script += `} catch { Write-Host 'ERROR:' $_; throw; }; `
		}
	}

	// Apply permissions for invalid groups using Get-ADObject
	if len(invalidGroups) > 0 {
		groupname := strings.Split(invalidGroups[0], `\`)[1]
		script += fmt.Sprintf(`try { $igroup1 = Get-ADObject -Filter {SamAccountName -eq '%s'} -Properties ObjectSID -Credential $credential; `, groupname)
		script += `$isidg1 = $igroup1.ObjectSID; `
		script += fmt.Sprintf(`$ipathg1 = '%s\permissions_test\invalid_principals\invalid_group_file.txt'; `, smbShare)
		script += `$iaclg1 = Get-Acl $ipathg1; $iaclg1.SetAccessRuleProtection($true, $true); `
		script += `$iruleg1 = New-Object System.Security.AccessControl.FileSystemAccessRule($isidg1, 'Modify', 'Allow'); `
		script += `$iaclg1.AddAccessRule($iruleg1); Set-Acl -Path $ipathg1 -AclObject $iaclg1 -ErrorAction Stop; `
		script += fmt.Sprintf(`Write-Host 'Applied permissions for %s'; `, invalidGroups[0])
		script += `} catch { Write-Host 'ERROR:' $_; throw; }; `
	}

	// Apply mixed permissions (both valid and invalid)
	if len(validUsers) > 0 && len(invalidUsers) > 0 {
		vusername := strings.Split(validUsers[0], `\`)[1]
		iusername := strings.Split(invalidUsers[0], `\`)[1]
		script += fmt.Sprintf(`try { $muser1 = Get-ADUser -Identity '%s' -Credential $credential; `, vusername)
		script += `$msid1 = New-Object System.Security.Principal.SecurityIdentifier($muser1.SID); `
		script += fmt.Sprintf(`$muser2 = Get-ADUser -Identity '%s' -Credential $credential; `, iusername)
		script += `$msid2 = New-Object System.Security.Principal.SecurityIdentifier($muser2.SID); `
		script += fmt.Sprintf(`$mpath = '%s\permissions_test\mixed_principals\mixed_file.txt'; `, smbShare)
		script += `$macl = Get-Acl $mpath; $macl.SetAccessRuleProtection($true, $true); `
		script += `$mrule1 = New-Object System.Security.AccessControl.FileSystemAccessRule($msid1, 'FullControl', 'Allow'); `
		script += `$mrule2 = New-Object System.Security.AccessControl.FileSystemAccessRule($msid2, 'Read', 'Allow'); `
		script += `$macl.AddAccessRule($mrule1); $macl.AddAccessRule($mrule2); `
		script += `Set-Acl -Path $mpath -AclObject $macl -ErrorAction Stop; `
		script += `Write-Host 'Applied mixed permissions'; `
		script += `} catch { Write-Host 'ERROR:' $_; throw; }; `
	}

	// Cleanup
	script += `Write-Host 'Listing created files...'; `
	script += fmt.Sprintf(`Get-ChildItem -Recurse '%s\permissions_test' | Select-Object -ExpandProperty FullName; `, smbShare)
	script += `net use Z: /delete /y 2>&1 | Out-Null; `
	script += `Remove-Item -Recurse -Force $localDir; `
	script += `Write-Host '===== Files and permissions created ====='"`

	return script
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

	// Use PowerShell with domain credentials to ensure AD user resolution works
	// This avoids icacls silent failures when usernames can't be resolved
	script := fmt.Sprintf(`powershell.exe -Command "`+
		`$password = ConvertTo-SecureString '%s' -AsPlainText -Force; `+
		`$credential = New-Object System.Management.Automation.PSCredential('%s', $password); `+

		`$localDir = 'C:\permissions_test'; `+
		`if (Test-Path $localDir) { Remove-Item -Recurse -Force $localDir }; `+
		`New-Item -ItemType Directory -Path $localDir | Out-Null; `+
		`New-Item -ItemType Directory -Path $localDir\scenario1_orphaned | Out-Null; `+
		`New-Item -ItemType Directory -Path $localDir\scenario2_name_mapping | Out-Null; `+
		`New-Item -ItemType Directory -Path $localDir\scenario3_unmapped | Out-Null; `+

		`'Orphaned SID test file' | Out-File -FilePath $localDir\scenario1_orphaned\orphaned_user_file.txt; `+
		`'Name mapping test file' | Out-File -FilePath $localDir\scenario2_name_mapping\name_mapping_file.txt; `+
		`'Unmapped user test file' | Out-File -FilePath $localDir\scenario3_unmapped\unmapped_user_file.txt; `+

		`net use Z: /delete /y 2>&1 | Out-Null; `+
		`$netUseResult = net use Z: %s /user:%s '%s' 2>&1; `+
		`if ($LASTEXITCODE -ne 0) { throw \"Failed to map drive: $netUseResult\" }; `+

		`Write-Host 'Removing old permissions_test directory from SMB share...'; `+
		`$remotePath = '%s\permissions_test'; `+
		`if (Test-Path $remotePath) { Remove-Item -Recurse -Force $remotePath }; `+
		`Write-Host 'Creating clean permissions_test directory...'; `+
		`New-Item -ItemType Directory -Path $remotePath -Force | Out-Null; `+
		`Write-Host 'Copying files to SMB share...'; `+
		`Copy-Item -Recurse -Force $localDir\* $remotePath; `+

		`Write-Host 'Applying permissions with domain credentials...'; `,
		PROTOCOL_PASSWORD, PROTOCOL_USERNAME,
		smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD,
		smbShare)

	// Apply permissions using AddAccessRule (not SetAccessRule) to ensure rules are added, not replaced
	// Also disable inheritance to prevent parent ACLs from interfering
	// Wrap in try/catch to capture Set-Acl failures
	// CRITICAL: Resolve usernames to SIDs first using AD cmdlets to avoid IdentityNotMappedException
	if len(users) > 0 {
		// Extract just the username part (remove domain prefix if present)
		username := users[0]
		if strings.Contains(username, `\`) {
			username = strings.Split(username, `\`)[1]
		}
		script += fmt.Sprintf(`try { `+
			`$user1 = Get-ADUser -Identity '%s' -Credential $credential; `+
			`$sid1 = New-Object System.Security.Principal.SecurityIdentifier($user1.SID); `+
			`$path1 = '%s\permissions_test\scenario1_orphaned\orphaned_user_file.txt'; `+
			`$acl1 = Get-Acl $path1; `+
			`$acl1.SetAccessRuleProtection($true, $true); `+
			`$rule1 = New-Object System.Security.AccessControl.FileSystemAccessRule($sid1, 'FullControl', 'Allow'); `+
			`$acl1.AddAccessRule($rule1); `+
			`Set-Acl -Path $path1 -AclObject $acl1 -ErrorAction Stop; `+
			`Write-Host 'Applied permissions for %s'; `+
			`} catch { Write-Host 'ERROR applying permissions for %s:' $_; throw; }; `,
			username, smbShare, users[0], users[0])
	}
	if len(users) > 1 {
		username := users[1]
		if strings.Contains(username, `\`) {
			username = strings.Split(username, `\`)[1]
		}
		script += fmt.Sprintf(`try { `+
			`$user2 = Get-ADUser -Identity '%s' -Credential $credential; `+
			`$sid2 = New-Object System.Security.Principal.SecurityIdentifier($user2.SID); `+
			`$path2 = '%s\permissions_test\scenario2_name_mapping\name_mapping_file.txt'; `+
			`$acl2 = Get-Acl $path2; `+
			`$acl2.SetAccessRuleProtection($true, $true); `+
			`$rule2 = New-Object System.Security.AccessControl.FileSystemAccessRule($sid2, 'Modify', 'Allow'); `+
			`$acl2.AddAccessRule($rule2); `+
			`Set-Acl -Path $path2 -AclObject $acl2 -ErrorAction Stop; `+
			`Write-Host 'Applied permissions for %s'; `+
			`} catch { Write-Host 'ERROR applying permissions for %s:' $_; throw; }; `,
			username, smbShare, users[1], users[1])
	}
	if len(users) > 2 {
		username := users[2]
		if strings.Contains(username, `\`) {
			username = strings.Split(username, `\`)[1]
		}
		script += fmt.Sprintf(`try { `+
			`$principal3 = Get-ADObject -Filter {SamAccountName -eq '%s'} -Properties ObjectSID -Credential $credential; `+
			`$sid3 = $principal3.ObjectSID; `+
			`$path3 = '%s\permissions_test\scenario3_unmapped\unmapped_user_file.txt'; `+
			`$acl3 = Get-Acl $path3; `+
			`$acl3.SetAccessRuleProtection($true, $true); `+
			`$rule3 = New-Object System.Security.AccessControl.FileSystemAccessRule($sid3, 'Read', 'Allow'); `+
			`$acl3.AddAccessRule($rule3); `+
			`Set-Acl -Path $path3 -AclObject $acl3 -ErrorAction Stop; `+
			`Write-Host 'Applied permissions for %s'; `+
			`} catch { Write-Host 'ERROR applying permissions for %s:' $_; throw; }; `,
			username, smbShare, users[2], users[2])
	}

	script += fmt.Sprintf(`Write-Host 'Listing created files...'; `+
		`Get-ChildItem -Recurse '%s\permissions_test' | Select-Object -ExpandProperty FullName; `+
		`net use Z: /delete /y 2>&1 | Out-Null; `+
		`Remove-Item -Recurse -Force $localDir; `+
		`Write-Host '===== SID mapping test files and permissions created ====='`+
		`"`,
		smbShare)

	return script
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

type SMBPermissionWithSID struct {
	FilePath    string
	IsDirectory bool
	ACLEntries  []ACLEntryWithSID
}

type ACLEntryWithSID struct {
	DisplayName string
	SID         string
	AccessType  string
	Permissions string
	ExistsInAD  bool
	IsOrphaned  bool
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

	// PowerShell script content
	psScriptContent := fmt.Sprintf(`$ErrorActionPreference = 'Stop'
$password = ConvertTo-SecureString '%s' -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential('%s', $password)
Import-Module ActiveDirectory -ErrorAction SilentlyContinue
try { net use '%s' /user:%s '%s' 2>&1 | Out-Null } catch { Write-Error "Failed to connect"; exit 1 }
if (Test-Path '%s') {
  $items = Get-ChildItem -Path '%s' -Recurse -Force
  $results = @()
  foreach ($item in $items) {
    try {
      $acl = Get-Acl -Path $item.FullName
      $aclEntries = @()
      foreach ($access in $acl.Access) {
        $identity = $access.IdentityReference
        $displayName = $identity.Value
        $rawSID = ''
        $existsInAD = $false
        $isOrphaned = $false
        $principalType = 'UNKNOWN'
        try {
          if ($identity -is [System.Security.Principal.SecurityIdentifier]) {
            $rawSID = $identity.Value
          } else {
            $sidObj = $identity.Translate([System.Security.Principal.SecurityIdentifier])
            $rawSID = $sidObj.Value
          }
        } catch { $rawSID = 'CANNOT_RESOLVE' }
        if ($rawSID -match '^S-1-5-21-') {
          try {
            $null = Get-ADUser -Identity $rawSID -Credential $credential -ErrorAction Stop
            $existsInAD = $true; $isOrphaned = $false; $principalType = 'USER'
          } catch {
            try {
              $null = Get-ADGroup -Identity $rawSID -Credential $credential -ErrorAction Stop
              $existsInAD = $true; $isOrphaned = $false; $principalType = 'GROUP'
            } catch {
              $existsInAD = $false; $isOrphaned = $true; $principalType = 'ORPHANED'
            }
          }
        } else {
          $existsInAD = $true; $isOrphaned = $false; $principalType = 'BUILTIN'
        }
        $aclEntries += [PSCustomObject]@{
          DisplayName = $displayName; SID = $rawSID; Type = $access.AccessControlType.ToString()
          Rights = $access.FileSystemRights.ToString(); ExistsInAD = $existsInAD
          IsOrphaned = $isOrphaned; PrincipalType = $principalType
        }
      }
      $results += [PSCustomObject]@{
        Path = $item.FullName; IsDirectory = $item.PSIsContainer; Access = $aclEntries
      }
    } catch { 
      Write-Warning "Failed to process $($item.FullName): $_"
    }
  }
  $results | ConvertTo-Json -Depth 10 -Compress
} else { 
  Write-Error "Path not found"; exit 1 
}
try { net use '%s' /delete /y 2>&1 | Out-Null } catch { }
`, adPassword, adUsername, uncPath, adUsername, adPassword, uncPath, uncPath, uncPath)

	// Write script to temp file to avoid command line length issues
	// Use Base64 encoding to avoid all quoting/escaping issues
	tempScriptPath := `C:\Temp\get-smb-perms-sid.ps1`

	// Base64 encode the script content as UTF-8 (not UTF-16LE like encodePowerShellCommand)
	b64Script := base64Encode([]byte(psScriptContent))

	// Decode Base64 and write to file
	decodeAndWriteScript := fmt.Sprintf(`[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('%s')) | Out-File -FilePath '%s' -Encoding UTF8 -Force`, b64Script, tempScriptPath)

	var parts []string
	parts = append(parts, `cmd /C`)
	parts = append(parts, `if not exist C:\Temp mkdir C:\Temp &&`)
	parts = append(parts, fmt.Sprintf(`powershell -Command "%s" &&`, decodeAndWriteScript))
	parts = append(parts, fmt.Sprintf(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%s" &&`, tempScriptPath))
	parts = append(parts, fmt.Sprintf(`del "%s"`, tempScriptPath))

	return strings.Join(parts, " ")
}

func parseSMBPermissionsWithSID(output string) ([]SMBPermissionWithSID, error) {
	// Try to extract JSON from output
	permissions, err := tryParsePowerShellJSONWithSID(output)
	if err == nil && len(permissions) > 0 {
		LogDebug(fmt.Sprintf("Successfully parsed %d permissions with SID from PowerShell JSON output", len(permissions)))
		return permissions, nil
	}

	// If parsing fails, return the error
	return nil, fmt.Errorf("failed to parse PowerShell JSON output with SID: %w", err)
}

// PowerShell Get-Acl JSON structures for SID permissions
type PowerShellACLResponseWithSID struct {
	Path        string                       `json:"Path"`
	IsDirectory bool                         `json:"IsDirectory"`
	Access      []PowerShellACLAccessWithSID `json:"Access"`
}

type PowerShellACLAccessWithSID struct {
	DisplayName   string `json:"DisplayName"`
	SID           string `json:"SID"`
	Type          string `json:"Type"`
	Rights        string `json:"Rights"`
	ExistsInAD    bool   `json:"ExistsInAD"`
	IsOrphaned    bool   `json:"IsOrphaned"`
	PrincipalType string `json:"PrincipalType"`
}

// tryParsePowerShellJSONWithSID attempts to extract and parse PowerShell JSON with SID data
func tryParsePowerShellJSONWithSID(output string) ([]SMBPermissionWithSID, error) {
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

	LogDebug(fmt.Sprintf("Attempting to parse JSON output with SID (length: %d)", len(jsonOutput)))

	// Try to parse as array first (multiple files)
	var psACLs []PowerShellACLResponseWithSID
	err := json.Unmarshal([]byte(jsonOutput), &psACLs)
	if err == nil {
		LogDebug(fmt.Sprintf("Successfully parsed %d ACL entries with SID from JSON array", len(psACLs)))
		return convertPowerShellACLsWithSIDToSMBPermissions(psACLs), nil
	}

	LogDebug(fmt.Sprintf("Failed to parse as array: %v", err))

	// Try to parse as single object
	var psACL PowerShellACLResponseWithSID
	err2 := json.Unmarshal([]byte(jsonOutput), &psACL)
	if err2 != nil {
		LogDebug(fmt.Sprintf("Failed to parse as single object: %v", err2))
		LogDebug(fmt.Sprintf("JSON content: %s", jsonOutput))
		return nil, fmt.Errorf("failed to parse JSON as array (%w) or single object (%v)", err, err2)
	}

	psACLs = []PowerShellACLResponseWithSID{psACL}
	LogDebug("Successfully parsed 1 ACL entry with SID from JSON object")
	return convertPowerShellACLsWithSIDToSMBPermissions(psACLs), nil
}

// convertPowerShellACLsWithSIDToSMBPermissions converts PowerShell Get-Acl JSON with SID to SMBPermissionWithSID
func convertPowerShellACLsWithSIDToSMBPermissions(psACLs []PowerShellACLResponseWithSID) []SMBPermissionWithSID {
	var permissions []SMBPermissionWithSID

	for _, psACL := range psACLs {
		perm := SMBPermissionWithSID{
			FilePath:    psACL.Path,
			IsDirectory: psACL.IsDirectory,
			ACLEntries:  []ACLEntryWithSID{},
		}

		// Convert PowerShell ACL entries to our ACLEntryWithSID format
		for _, access := range psACL.Access {
			aclEntry := ACLEntryWithSID{
				DisplayName: access.DisplayName,
				SID:         access.SID,
				AccessType:  access.Type,
				Permissions: access.Rights,
				ExistsInAD:  access.ExistsInAD,
				IsOrphaned:  access.IsOrphaned,
			}

			perm.ACLEntries = append(perm.ACLEntries, aclEntry)
		}

		permissions = append(permissions, perm)
	}

	return permissions
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

// CreateSMBFilesWithInheritanceScenarios creates test structure for 6 inheritance scenarios
// Uses a SEPARATE directory (inheritance_test) to avoid conflicts with permissions_test
//
// Creates 12 items (7 folders + 5 files):
//
//	inheritance_test/                              [Share root]
//	├─ share_level_file.txt                        [S1: Inherits from share]
//	├─ inheritance_enabled/                        [S2: L1 with (OI)(CI)]
//	│  ├─ file1.txt                                [Inherits from parent]
//	│  ├─ child_enabled/                           [S4: L2 both enabled]
//	│  │  └─ file2.txt                             [Multi-level inheritance]
//	│  └─ child_disabled/                          [S6: Mixed - blocks parent]
//	│     └─ file3.txt                             [Explicit only]
//	└─ inheritance_disabled/                       [S3: L1 blocked]
//	   ├─ file1.txt                                [Explicit only]
//	   └─ child_disabled/                          [S5: L2 both blocked]
//	      └─ file2.txt                             [Explicit only]
func CreateSMBFilesWithInheritanceScenarios(export string) error {
	script := createInheritanceTestStructureScript(export)

	LogDebug(fmt.Sprintf("Creating SMB files with inheritance scenarios on: %s", export))

	config := GetAttachedWorkerDetails()
	sshConfig := SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
	}

	output, err := sshRunScript(sshConfig, script)
	LogDebug(fmt.Sprintf("CreateSMBFilesWithInheritanceScenarios output: %s", output))

	if err != nil {
		return fmt.Errorf("CreateSMBFilesWithInheritanceScenarios failed: %w\noutput: %s", err, output)
	}

	LogDebug("Successfully created inheritance test structure")
	return nil
}

func createInheritanceTestStructureScript(export string) string {
	split := strings.Split(export, ":")
	smbShare := fmt.Sprintf(`\\%s\%s`, strings.TrimSpace(split[0]), strings.TrimSpace(split[1]))

	localTestDir := `C:\inheritance_test`
	testDir := `inheritance_test`
	mappedDrive := `Z:`
	share := fmt.Sprintf(`%s\%s`, smbShare, testDir)

	var parts []string
	parts = append(parts, `cmd /C`)
	parts = append(parts, fmt.Sprintf(`if exist %s rmdir /s /q %s &&`, localTestDir, localTestDir))
	parts = append(parts, fmt.Sprintf(`mkdir %s &&`, localTestDir))
	parts = append(parts, fmt.Sprintf(`mkdir %s\inheritance_enabled &&`, localTestDir))
	parts = append(parts, fmt.Sprintf(`mkdir %s\inheritance_disabled &&`, localTestDir))
	parts = append(parts, fmt.Sprintf(`mkdir %s\inheritance_enabled\child_enabled &&`, localTestDir))
	parts = append(parts, fmt.Sprintf(`mkdir %s\inheritance_disabled\child_disabled &&`, localTestDir))
	parts = append(parts, fmt.Sprintf(`mkdir %s\inheritance_enabled\child_disabled &&`, localTestDir))
	parts = append(parts, fmt.Sprintf(`echo Share level file > %s\share_level_file.txt &&`, localTestDir))
	parts = append(parts, fmt.Sprintf(`echo L1 enabled file > %s\inheritance_enabled\file1.txt &&`, localTestDir))
	parts = append(parts, fmt.Sprintf(`echo L1 disabled file > %s\inheritance_disabled\file1.txt &&`, localTestDir))
	parts = append(parts, fmt.Sprintf(`echo L2 enabled file > %s\inheritance_enabled\child_enabled\file2.txt &&`, localTestDir))
	parts = append(parts, fmt.Sprintf(`echo L2 disabled file > %s\inheritance_disabled\child_disabled\file2.txt &&`, localTestDir))
	parts = append(parts, fmt.Sprintf(`echo Mixed file > %s\inheritance_enabled\child_disabled\file3.txt &&`, localTestDir))
	parts = append(parts, fmt.Sprintf(`net use %s /delete /y >nul 2>&1 &`, mappedDrive))
	parts = append(parts, fmt.Sprintf(`net use %s %s /user:%s "%s" &&`, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD))
	parts = append(parts, fmt.Sprintf(`(if exist %s\ ( rmdir /s /q %s ) else ( echo "permissions_test not found" )) &`, share, share))
	parts = append(parts, fmt.Sprintf(`xcopy /E /I /Y %s %s &&`, localTestDir, share))

	// 5. Set up inheritance scenarios
	parts = append(parts, `echo ===== SCENARIO 1: Share Level (default) ===== &&`)
	parts = append(parts, fmt.Sprintf(`icacls "%s" /grant Everyone:M &&`, share))

	parts = append(parts, `echo ===== SCENARIO 2: Level 1 - Inheritance ENABLED (OI)(CI) ===== &&`)
	parts = append(parts, fmt.Sprintf(`icacls "%s\inheritance_enabled" /grant Everyone:(OI)(CI)F &&`, share))

	parts = append(parts, `echo ===== SCENARIO 3: Level 1 - Inheritance DISABLED ===== &&`)
	parts = append(parts, fmt.Sprintf(`icacls "%s\inheritance_disabled" /inheritance:r &&`, share))
	parts = append(parts, fmt.Sprintf(`icacls "%s\inheritance_disabled" /grant "BUILTIN\Administrators":F &&`, share))
	parts = append(parts, fmt.Sprintf(`icacls "%s\inheritance_disabled\file1.txt" /inheritance:r &&`, share))
	parts = append(parts, fmt.Sprintf(`icacls "%s\inheritance_disabled\file1.txt" /grant "BUILTIN\Users":R &&`, share))

	parts = append(parts, `echo ===== SCENARIO 4: Level 2 - Both Enabled ===== &&`)
	parts = append(parts, fmt.Sprintf(`icacls "%s\inheritance_enabled\child_enabled" /grant Everyone:(OI)(CI)M &&`, share))

	parts = append(parts, `echo ===== SCENARIO 5: Level 2 - Both Disabled ===== &&`)
	parts = append(parts, fmt.Sprintf(`icacls "%s\inheritance_disabled\child_disabled" /inheritance:r &&`, share))
	parts = append(parts, fmt.Sprintf(`icacls "%s\inheritance_disabled\child_disabled" /grant "BUILTIN\Users":M &&`, share))
	parts = append(parts, fmt.Sprintf(`icacls "%s\inheritance_disabled\child_disabled\file2.txt" /inheritance:r &&`, share))
	parts = append(parts, fmt.Sprintf(`icacls "%s\inheritance_disabled\child_disabled\file2.txt" /grant Everyone:R &&`, share))

	parts = append(parts, `echo ===== SCENARIO 6: MIXED - Parent Enabled, Child Blocks ===== &&`)
	parts = append(parts, fmt.Sprintf(`icacls "%s\inheritance_enabled\child_disabled" /inheritance:r &&`, share))
	parts = append(parts, fmt.Sprintf(`icacls "%s\inheritance_enabled\child_disabled" /grant "BUILTIN\Users":F &&`, share))
	parts = append(parts, fmt.Sprintf(`icacls "%s\inheritance_enabled\child_disabled\file3.txt" /inheritance:r &&`, share))
	parts = append(parts, fmt.Sprintf(`icacls "%s\inheritance_enabled\child_disabled\file3.txt" /grant "BUILTIN\Users":RX &&`, share))

	// 6. Verify
	parts = append(parts, `echo ===== Verifying structure ===== &&`)
	parts = append(parts, fmt.Sprintf(`dir %s /s /b &&`, share))
	parts = append(parts, fmt.Sprintf(`net use %s /delete /y &&`, mappedDrive))
	parts = append(parts, fmt.Sprintf(`rmdir /s /q %s`, localTestDir))

	return strings.Join(parts, " ")
}

func GetSMBPermissionsWithInheritanceDetails(export string) ([]SMBFilePermission, error) {
	// Use the inheritance-specific function instead of the generic comprehensive one
	permissions, err := GetSMBPermissionsForInheritanceTest(export)
	if err != nil {
		return nil, fmt.Errorf("GetSMBPermissionsWithInheritanceDetails failed: %w", err)
	}

	// Validate that inheritance flags are captured
	for i := range permissions {
		if len(permissions[i].ACLEntries) == 0 {
			LogDebug(fmt.Sprintf("Warning: No ACL entries for %s", permissions[i].FilePath))
		}
	}

	return permissions, nil
}

// GetSMBPermissionsForInheritanceTest retrieves permissions for the inheritance test structure
func GetSMBPermissionsForInheritanceTest(export string) ([]SMBFilePermission, error) {
	script := getSMBPermissionsForInheritanceTestScript(export)

	LogDebug(fmt.Sprintf("Getting inheritance test SMB file permissions script: %s", script))

	config := GetAttachedWorkerDetails()
	sshConfig := SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
	}

	output, err := sshRunScript(sshConfig, script)
	LogDebug("GetSMBPermissionsForInheritanceTest script successfully executed")

	if err != nil {
		return nil, fmt.Errorf("GetSMBPermissionsForInheritanceTest failed: %w\noutput: %s", err, output)
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

func getSMBPermissionsForInheritanceTestScript(export string) string {
	split := strings.Split(export, ":")
	smbShare := fmt.Sprintf(`\\%s\%s`, strings.TrimSpace(split[0]), strings.TrimSpace(split[1]))

	mappedDrive := `Z:`
	testDir := `inheritance_test`
	share := fmt.Sprintf(`%s\%s`, mappedDrive, testDir)

	// PowerShell script to get comprehensive ACLs in JSON format for inheritance test structure
	psScript := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
try { net use %s /delete /y *>$null } catch { }
net use %s %s /user:%s "%s" | Out-Null

if (Test-Path "%s") {
    $paths = @(
        "%s\share_level_file.txt",
        "%s\inheritance_enabled",
        "%s\inheritance_enabled\file1.txt",
        "%s\inheritance_enabled\child_enabled",
        "%s\inheritance_enabled\child_enabled\file2.txt",
        "%s\inheritance_enabled\child_disabled",
        "%s\inheritance_enabled\child_disabled\file3.txt",
        "%s\inheritance_disabled",
        "%s\inheritance_disabled\file1.txt",
        "%s\inheritance_disabled\child_disabled",
        "%s\inheritance_disabled\child_disabled\file2.txt",
        "%s"
    )
    
    $results = @()
    foreach ($path in $paths) {
        if (Test-Path $path) {
            $acl = Get-Acl $path
            $isDir = (Get-Item $path) -is [System.IO.DirectoryInfo]
            
            $accessList = @()
            if ($acl.Access -ne $null) {
                $accessList = @($acl.Access | ForEach-Object {
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
            
            $obj = [PSCustomObject]@{
                Path = $path
                Owner = $acl.Owner
                IsDirectory = $isDir
                Access = $accessList
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
		share, share, share, share, share, share, share, share, share, share, share, share, share, share, mappedDrive)

	// Encode PowerShell script in Base64 to avoid quoting issues
	return fmt.Sprintf(`powershell.exe -NoProfile -NonInteractive -EncodedCommand "%s"`, encodePowerShellCommand(psScript))
}

// This CALLS CompareSMBPermissions (doesn't modify it) and adds extra checks
func CompareSMBPermissionsWithInheritanceValidation(sourcePerms, destPerms []SMBFilePermission) error {
	// First, use existing comparison function
	err := CompareSMBPermissions(sourcePerms, destPerms)
	if err != nil {
		return fmt.Errorf("base permission comparison failed: %w", err)
	}

	// Additional inheritance-specific validation
	LogDebug("Starting inheritance-specific validation...")

	// Build maps for comparison
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

	var inheritanceIssues []string

	// Check inheritance blocking scenarios
	for fileName, sourcePerm := range sourceMap {
		destPerm, exists := destMap[fileName]
		if !exists {
			continue // Already caught by base comparison
		}

		sourceBlocked := isInheritanceBlocked(sourcePerm)
		destBlocked := isInheritanceBlocked(destPerm)

		if sourceBlocked != destBlocked {
			inheritanceIssues = append(inheritanceIssues,
				fmt.Sprintf("Inheritance blocking mismatch for %s: source blocked=%v, dest blocked=%v",
					fileName, sourceBlocked, destBlocked))
		}
	}

	if len(inheritanceIssues) > 0 {
		LogDebug(fmt.Sprintf("Inheritance validation issues: %v", inheritanceIssues))
		return fmt.Errorf("inheritance validation failed: %v", inheritanceIssues)
	}

	LogDebug("Inheritance validation passed")
	return nil
}

// Improved version that checks both inherited ACLs and propagation flags
func isInheritanceBlocked(perm SMBFilePermission) bool {
	if len(perm.ACLEntries) == 0 {
		return false
	}

	// Count inherited ACLs (have "I" flag)
	inheritedCount := 0
	hasPropagationFlags := false

	for _, acl := range perm.ACLEntries {
		// Check for inherited flag
		for _, flag := range acl.InheritanceFlags {
			if flag == "I" {
				inheritedCount++
			}
			if flag == "OI" || flag == "CI" {
				hasPropagationFlags = true
			}
		}
	}

	// Determine if this is root level
	isRootLevel := !strings.Contains(perm.FilePath, "\\") ||
		strings.Count(perm.FilePath, "\\") <= 1

	if isRootLevel {
		return false // Root level naturally has no inherited ACLs
	}

	// If no inherited ACLs and no propagation flags, inheritance is blocked
	// Exception: if it has propagation flags, it's explicit but not blocked
	return inheritedCount == 0 && !hasPropagationFlags
}

// LogInheritanceScenarioSummary logs a summary of inheritance scenarios found
func LogInheritanceScenarioSummary(permissions []SMBFilePermission) {
	shareLevel := 0
	level1Enabled := 0
	level1Disabled := 0
	level2Enabled := 0
	level2Disabled := 0
	mixedScenario := 0

	for _, perm := range permissions {
		path := strings.ToLower(perm.FilePath)

		if strings.HasSuffix(path, "permissions_test") {
			shareLevel++
		} else if strings.Contains(path, "inheritance_enabled") && !strings.Contains(path, "child") {
			level1Enabled++
		} else if strings.Contains(path, "inheritance_disabled") && !strings.Contains(path, "child") {
			level1Disabled++
		} else if strings.Contains(path, "inheritance_enabled\\child_enabled") ||
			strings.Contains(path, "inheritance_enabled/child_enabled") {
			level2Enabled++
		} else if strings.Contains(path, "inheritance_disabled\\child_disabled") ||
			strings.Contains(path, "inheritance_disabled/child_disabled") {
			level2Disabled++
		} else if strings.Contains(path, "inheritance_enabled\\child_disabled") ||
			strings.Contains(path, "inheritance_enabled/child_disabled") {
			mixedScenario++
		}
	}

	LogDebug("Inheritance Scenario Summary:")
	LogDebug(fmt.Sprintf("  Share Level: %d items", shareLevel))
	LogDebug(fmt.Sprintf("  L1 Enabled: %d items", level1Enabled))
	LogDebug(fmt.Sprintf("  L1 Disabled: %d items", level1Disabled))
	LogDebug(fmt.Sprintf("  L2 Enabled: %d items", level2Enabled))
	LogDebug(fmt.Sprintf("  L2 Disabled: %d items", level2Disabled))
	LogDebug(fmt.Sprintf("  Mixed (Parent Child): %d items", mixedScenario))
	LogDebug(fmt.Sprintf("  Total items: %d", len(permissions)))
}
