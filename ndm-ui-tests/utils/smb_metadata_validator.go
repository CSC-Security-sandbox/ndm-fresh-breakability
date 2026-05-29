package utils

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"ndm-ui-tests/config"
)

// ─── Public types ─────────────────────────────────────────────────────────────

// SMBMetadataEntry holds per-entry metadata collected from an SMB share.
type SMBMetadataEntry struct {
	Path       string          `json:"Path"`       // relative path from share root, forward-slash separated
	Type       string          `json:"Type"`       // "File" or "Directory"
	SizeBytes  int64           `json:"SizeBytes"`  // 0 for directories
	MtimeEpoch int64           `json:"MtimeEpoch"` // LastWriteTimeUtc as Unix epoch
	AtimeEpoch int64           `json:"AtimeEpoch"` // LastAccessTimeUtc as Unix epoch
	Owner      string          `json:"Owner"`
	ACLEntries []SMBACLEntry   `json:"ACLEntries"`
}

// SMBACLEntry represents one Windows ACE on a file/directory.
type SMBACLEntry struct {
	Principal        string `json:"Principal"`
	Rights           string `json:"Rights"`
	Type             string `json:"Type"`             // "Allow" or "Deny"
	IsInherited      bool   `json:"IsInherited"`
	InheritanceFlags string `json:"InheritanceFlags"` // e.g. "ContainerInherit, ObjectInherit"
	PropagationFlags string `json:"PropagationFlags"` // e.g. "None"
}

// SMBMetadataDiscrepancy describes a single field-level mismatch between shares.
type SMBMetadataDiscrepancy struct {
	Path     string
	Field    string
	SrcValue string
	DstValue string
}

// SMBMetadataResult is returned by CompareSMBMetadata.
type SMBMetadataResult struct {
	TotalSrc      int
	TotalDst      int
	SrcOnlyPaths  []string
	DstOnlyPaths  []string
	Discrepancies []SMBMetadataDiscrepancy
}

// HasMismatches returns true when any entry is missing or has a field difference.
func (r *SMBMetadataResult) HasMismatches() bool {
	return len(r.SrcOnlyPaths) > 0 || len(r.DstOnlyPaths) > 0 || len(r.Discrepancies) > 0
}

// Summary returns a human-readable one-liner.
func (r *SMBMetadataResult) Summary() string {
	if !r.HasMismatches() {
		return fmt.Sprintf("OK – %d entries match", r.TotalSrc)
	}
	return fmt.Sprintf(
		"%d discrepancies, %d src-only, %d dst-only (src=%d dst=%d entries)",
		len(r.Discrepancies), len(r.SrcOnlyPaths), len(r.DstOnlyPaths),
		r.TotalSrc, r.TotalDst,
	)
}

// SMBCompareOptions controls which fields are compared.
type SMBCompareOptions struct {
	SkipAtime bool // do not compare LastAccessTime
	SkipACL   bool // do not compare Windows ACL entries
	SkipOwner bool // do not compare owner
	SkipSize  bool // do not compare file size
}

// ─── Main entry point ─────────────────────────────────────────────────────────

// ScanSMBSharesRaw scans both shares and returns the raw entry lists without
// comparing them. Useful for dumping to files for inspection.
func ScanSMBSharesRaw(srcShare, dstShare string) ([]SMBMetadataEntry, []SMBMetadataEntry, error) {
	workerCfg := SSHConfig{
		Host:     config.SMBWorkerHost,
		Port:     config.SMBWorkerPort,
		Username: config.SMBWorkerUsername,
		Password: config.SMBWorkerPassword,
	}
	if workerCfg.Host == "" {
		return nil, nil, fmt.Errorf("SMB worker host is not configured (NDM_SMB_WORKER_HOST)")
	}

	srcEntries, err := scanSMBShare(workerCfg, srcShare, "X:")
	if err != nil {
		return nil, nil, fmt.Errorf("scan source share %s: %w", srcShare, err)
	}
	dstEntries, err := scanSMBShare(workerCfg, dstShare, "Y:")
	if err != nil {
		return nil, nil, fmt.Errorf("scan destination share %s: %w", dstShare, err)
	}
	return srcEntries, dstEntries, nil
}

// CompareSMBMetadataWithEntries is like CompareSMBMetadata but also returns
// the raw scanned entries for dumping to files.
func CompareSMBMetadataWithEntries(srcShare, dstShare string, opts SMBCompareOptions) (*SMBMetadataResult, []SMBMetadataEntry, []SMBMetadataEntry, error) {
	workerCfg := SSHConfig{
		Host:     config.SMBWorkerHost,
		Port:     config.SMBWorkerPort,
		Username: config.SMBWorkerUsername,
		Password: config.SMBWorkerPassword,
	}
	if workerCfg.Host == "" {
		return nil, nil, nil, fmt.Errorf("SMB worker host is not configured (NDM_SMB_WORKER_HOST)")
	}

	srcEntries, err := scanSMBShare(workerCfg, srcShare, "X:")
	if err != nil {
		return nil, nil, nil, fmt.Errorf("scan source share %s: %w", srcShare, err)
	}
	dstEntries, err := scanSMBShare(workerCfg, dstShare, "Y:")
	if err != nil {
		return nil, srcEntries, nil, fmt.Errorf("scan destination share %s: %w", dstShare, err)
	}

	result := diffSMBEntries(srcEntries, dstEntries, opts)
	return result, srcEntries, dstEntries, nil
}

// CompareSMBMetadata scans srcShare and dstShare via the configured Windows
// worker (NDM_SMB_WORKER_HOST) and compares metadata entry-by-entry.
//
// srcShare / dstShare must be UNC paths, e.g. \\172.30.202.20\share_name.
// SMB credentials are taken from config.SMBUsername / config.SMBPassword.
func CompareSMBMetadata(srcShare, dstShare string, opts SMBCompareOptions) (*SMBMetadataResult, error) {
	workerCfg := SSHConfig{
		Host:     config.SMBWorkerHost,
		Port:     config.SMBWorkerPort,
		Username: config.SMBWorkerUsername,
		Password: config.SMBWorkerPassword,
	}

	if workerCfg.Host == "" {
		return nil, fmt.Errorf("SMB worker host is not configured (NDM_SMB_WORKER_HOST)")
	}

	LogDebug(fmt.Sprintf("CompareSMBMetadata: scanning src=%s dst=%s via worker %s", srcShare, dstShare, workerCfg.Host))

	srcEntries, err := scanSMBShare(workerCfg, srcShare, "X:")
	if err != nil {
		return nil, fmt.Errorf("scan source share %s: %w", srcShare, err)
	}
	LogDebug(fmt.Sprintf("CompareSMBMetadata: src has %d entries", len(srcEntries)))

	dstEntries, err := scanSMBShare(workerCfg, dstShare, "Y:")
	if err != nil {
		return nil, fmt.Errorf("scan destination share %s: %w", dstShare, err)
	}
	LogDebug(fmt.Sprintf("CompareSMBMetadata: dst has %d entries", len(dstEntries)))

	result := diffSMBEntries(srcEntries, dstEntries, opts)
	LogDebug(fmt.Sprintf("CompareSMBMetadata: %s", result.Summary()))
	return result, nil
}

// ─── Share scanner ────────────────────────────────────────────────────────────

// scanSMBShare maps share to driveLetter on the Windows worker, enumerates
// every entry recursively via PowerShell Get-ChildItem + Get-Acl, and returns
// the parsed entries.  driveLetter must be a Windows drive letter with colon,
// e.g. "X:".
func scanSMBShare(worker SSHConfig, share, driveLetter string) ([]SMBMetadataEntry, error) {
	psScript := buildScanScript(share, driveLetter, config.SMBUsername, config.SMBPassword)
	cmd := fmt.Sprintf(`powershell.exe -NoProfile -NonInteractive -EncodedCommand "%s"`,
		encodeSMBPowerShell(psScript))

	LogDebug(fmt.Sprintf("scanSMBShare: executing PowerShell on %s for share %s", worker.Host, share))
	output, err := RunScript(worker, cmd)
	if err != nil {
		return nil, fmt.Errorf("PowerShell execution failed: %w\noutput: %s", err, output)
	}

	entries, err := parseScanOutput(output)
	if err != nil {
		return nil, fmt.Errorf("parse scan output: %w\nraw output: %s", err, output)
	}
	return entries, nil
}

// buildScanScript returns a PowerShell script that enumerates share and emits
// JSON with one SMBMetadataEntry per line.
func buildScanScript(share, drive, username, password string) string {
	return fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
$drive  = "%s"
$share  = "%s"
$user   = "%s"
$pass   = "%s"

try { net use $drive /delete /y 2>$null | Out-Null } catch {}
$mountOut = net use $drive $share /user:$user $pass 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "net use failed: $mountOut"
    exit 1
}

$root = $drive + "\"
$results = [System.Collections.Generic.List[object]]::new()

try {
    Get-ChildItem -Path $root -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '~snapshot|\.snapshot' } | ForEach-Object {
        $item = $_
        $relPath = $item.FullName.Substring($root.Length).Replace('\', '/')

        $owner    = ""
        $aceList  = @()
        try {
            $acl   = Get-Acl -Path $item.FullName -ErrorAction SilentlyContinue
            $owner = $acl.Owner
            $aceList = @($acl.Access | ForEach-Object {
                [PSCustomObject]@{
                    Principal        = $_.IdentityReference.Value
                    Rights           = $_.FileSystemRights.ToString()
                    Type             = $_.AccessControlType.ToString()
                    IsInherited      = $_.IsInherited
                    InheritanceFlags = $_.InheritanceFlags.ToString()
                    PropagationFlags = $_.PropagationFlags.ToString()
                }
            })
        } catch {}

        $results.Add([PSCustomObject]@{
            Path       = $relPath
            Type       = if ($item.PSIsContainer) { "Directory" } else { "File" }
            SizeBytes  = if ($item.PSIsContainer) { [int64]0 } else { [int64]$item.Length }
            MtimeEpoch = [int64]($item.LastWriteTimeUtc  - [datetime]'1970-01-01').TotalSeconds
            AtimeEpoch = [int64]($item.LastAccessTimeUtc - [datetime]'1970-01-01').TotalSeconds
            Owner      = $owner
            ACLEntries = $aceList
        })
    }
} finally {
    try { net use $drive /delete /y 2>$null | Out-Null } catch {}
}

if ($results.Count -eq 0) {
    Write-Output "[]"
} else {
    $results | ConvertTo-Json -Depth 10 -Compress
}
`, drive, share, username, password)
}

// ─── Output parser ────────────────────────────────────────────────────────────

func parseScanOutput(output string) ([]SMBMetadataEntry, error) {
	output = strings.TrimSpace(output)
	if output == "" {
		return nil, fmt.Errorf("empty output from PowerShell scan")
	}

	// Find the start of the JSON array (skip any preceding log lines).
	jsonStart := strings.Index(output, "[")
	if jsonStart == -1 {
		return nil, fmt.Errorf("no JSON array found in output")
	}
	jsonPart := output[jsonStart:]

	// Find matching closing bracket.
	end := findSMBJSONEnd(jsonPart)
	if end > 0 {
		jsonPart = jsonPart[:end]
	}

	var entries []SMBMetadataEntry
	if err := json.Unmarshal([]byte(jsonPart), &entries); err != nil {
		return nil, fmt.Errorf("JSON unmarshal: %w", err)
	}
	return entries, nil
}

// findSMBJSONEnd returns the index one past the closing bracket/brace of the
// outermost JSON structure in s, or -1 if not found.
func findSMBJSONEnd(s string) int {
	if len(s) == 0 {
		return -1
	}
	depth := 0
	inStr := false
	escape := false
	var end byte
	switch s[0] {
	case '[':
		end = ']'
	case '{':
		end = '}'
	default:
		return -1
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if escape {
			escape = false
			continue
		}
		if c == '\\' {
			escape = true
			continue
		}
		if c == '"' {
			inStr = !inStr
			continue
		}
		if inStr {
			continue
		}
		if c == '[' || c == '{' {
			depth++
		} else if c == ']' || c == '}' {
			depth--
			if depth == 0 && (c == end) {
				return i + 1
			}
		}
	}
	return -1
}

// ─── Comparison engine ────────────────────────────────────────────────────────

func diffSMBEntries(src, dst []SMBMetadataEntry, opts SMBCompareOptions) *SMBMetadataResult {
	result := &SMBMetadataResult{
		TotalSrc: len(src),
		TotalDst: len(dst),
	}

	srcMap := make(map[string]SMBMetadataEntry, len(src))
	dstMap := make(map[string]SMBMetadataEntry, len(dst))
	for _, e := range src {
		srcMap[e.Path] = e
	}
	for _, e := range dst {
		dstMap[e.Path] = e
	}

	// Paths only in source.
	for path := range srcMap {
		if _, ok := dstMap[path]; !ok {
			result.SrcOnlyPaths = append(result.SrcOnlyPaths, path)
		}
	}

	// Paths only in destination.
	for path := range dstMap {
		if _, ok := srcMap[path]; !ok {
			result.DstOnlyPaths = append(result.DstOnlyPaths, path)
		}
	}

	// Field-level comparison for paths present in both.
	for path, s := range srcMap {
		d, ok := dstMap[path]
		if !ok {
			continue
		}

		record := func(field, sv, dv string) {
			result.Discrepancies = append(result.Discrepancies, SMBMetadataDiscrepancy{
				Path: path, Field: field, SrcValue: sv, DstValue: dv,
			})
		}

		if s.Type != d.Type {
			record("type", s.Type, d.Type)
			continue // no point comparing further if the entry type differs
		}

		if !opts.SkipSize && s.Type == "File" && s.SizeBytes != d.SizeBytes {
			record("size_bytes", fmt.Sprintf("%d", s.SizeBytes), fmt.Sprintf("%d", d.SizeBytes))
		}

		if s.MtimeEpoch != d.MtimeEpoch {
			record("mtime", fmt.Sprintf("%d", s.MtimeEpoch), fmt.Sprintf("%d", d.MtimeEpoch))
		}

		if !opts.SkipAtime && s.AtimeEpoch != d.AtimeEpoch {
			record("atime", fmt.Sprintf("%d", s.AtimeEpoch), fmt.Sprintf("%d", d.AtimeEpoch))
		}

		if !opts.SkipOwner && !strings.EqualFold(s.Owner, d.Owner) {
			record("owner", s.Owner, d.Owner)
		}

		if !opts.SkipACL {
			if diff := diffACLEntries(s.ACLEntries, d.ACLEntries); diff != "" {
				record("acl", normalizeACLString(s.ACLEntries), normalizeACLString(d.ACLEntries))
				LogDebug(fmt.Sprintf("ACL diff for %s: %s", path, diff))
			}
		}
	}

	// Sort for deterministic output.
	sort.Strings(result.SrcOnlyPaths)
	sort.Strings(result.DstOnlyPaths)
	sort.Slice(result.Discrepancies, func(i, j int) bool {
		if result.Discrepancies[i].Path != result.Discrepancies[j].Path {
			return result.Discrepancies[i].Path < result.Discrepancies[j].Path
		}
		return result.Discrepancies[i].Field < result.Discrepancies[j].Field
	})

	return result
}

// diffACLEntries returns a non-empty description if the two ACL lists differ
// after normalization, otherwise "".
func diffACLEntries(src, dst []SMBACLEntry) string {
	srcKey := normalizeACLString(src)
	dstKey := normalizeACLString(dst)
	if srcKey == dstKey {
		return ""
	}
	return fmt.Sprintf("src=%s dst=%s", srcKey, dstKey)
}

// normalizeACLString builds a canonical, sorted string representation of ACL
// entries so that ordering differences do not cause false positives.
func normalizeACLString(entries []SMBACLEntry) string {
	keys := make([]string, 0, len(entries))
	for _, e := range entries {
		keys = append(keys, fmt.Sprintf("%s|%s|%s|%s|%s",
			strings.ToUpper(e.Principal),
			strings.ToUpper(e.Type),
			e.Rights,
			e.InheritanceFlags,
			e.PropagationFlags,
		))
	}
	sort.Strings(keys)
	return strings.Join(keys, ";")
}

// ─── PowerShell encoding helpers ─────────────────────────────────────────────

// encodeSMBPowerShell base64-encodes script as UTF-16LE for use with
// powershell.exe -EncodedCommand.
func encodeSMBPowerShell(script string) string {
	utf16 := smbEncodeUTF16LE(script)
	return smbBase64(utf16)
}

func smbEncodeUTF16LE(s string) []byte {
	runes := []rune(s)
	out := make([]byte, len(runes)*2)
	for i, r := range runes {
		out[i*2] = byte(r)
		out[i*2+1] = byte(r >> 8)
	}
	return out
}

func smbBase64(data []byte) string {
	const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	encoded := make([]byte, (len(data)+2)/3*4)
	for i, j := 0, 0; i < len(data); i, j = i+3, j+4 {
		b := uint32(data[i]) << 16
		if i+1 < len(data) {
			b |= uint32(data[i+1]) << 8
		}
		if i+2 < len(data) {
			b |= uint32(data[i+2])
		}
		encoded[j] = table[(b>>18)&0x3F]
		encoded[j+1] = table[(b>>12)&0x3F]
		if i+1 < len(data) {
			encoded[j+2] = table[(b>>6)&0x3F]
		} else {
			encoded[j+2] = '='
		}
		if i+2 < len(data) {
			encoded[j+3] = table[b&0x3F]
		} else {
			encoded[j+3] = '='
		}
	}
	return string(encoded)
}
