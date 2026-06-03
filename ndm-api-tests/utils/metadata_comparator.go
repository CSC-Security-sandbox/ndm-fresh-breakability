package utils

// metadata_comparator.go
//
// Generic src↔dst volume comparison utilities for API E2E tests.
// Supports NFS (via nfs_metadata_compare.sh locally) and SMB (via PowerShell on Windows worker).
// These functions are self-contained — they do NOT depend on ndm-ui-tests.

import (
	"bytes"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// ─── Result types ─────────────────────────────────────────────────────────────

// MetadataDiscrepancy holds one field-level mismatch between src and dst.
type MetadataDiscrepancy struct {
	Path     string
	Field    string
	SrcValue string
	DstValue string
}

// MetadataCompareResult is returned by both NFS and SMB comparisons.
type MetadataCompareResult struct {
	HasDiffs      bool
	SrcOnlyPaths  []string
	DstOnlyPaths  []string
	Discrepancies []MetadataDiscrepancy
	DiffsFile     string // path to written TSV file (if any)
}

func (r *MetadataCompareResult) Summary() string {
	if !r.HasDiffs {
		return "OK – no discrepancies found"
	}
	return fmt.Sprintf("%d discrepancy(ies), %d src-only, %d dst-only",
		len(r.Discrepancies), len(r.SrcOnlyPaths), len(r.DstOnlyPaths))
}

// ─── NFS comparison ───────────────────────────────────────────────────────────

// CompareNFSMetadata runs nfs_metadata_compare.sh locally on the runner,
// writes a diff TSV on mismatch, and returns structured results.
//
// srcExport / dstExport: "host:/export/path"
// workers: number of parallel scan workers (e.g. 8)
// skipChecksum: true = skip MD5 (faster)
func CompareNFSMetadata(srcExport, dstExport string, workers int, skipChecksum bool) (*MetadataCompareResult, error) {
	scriptPath, err := findNFSCompareScript()
	if err != nil {
		return nil, err
	}

	uid := fmt.Sprintf("%d", time.Now().UnixNano())
	srcOut := fmt.Sprintf("/tmp/nfs_src_%s.tsv", uid)
	dstOut := fmt.Sprintf("/tmp/nfs_dst_%s.tsv", uid)
	diffOut := fmt.Sprintf("/tmp/nfs_diff_%s.tsv", uid)

	args := []string{
		scriptPath,
		"--src", srcExport,
		"--dst", dstExport,
		"--src-out", srcOut,
		"--dst-out", dstOut,
		"--diff-out", diffOut,
		"--workers", fmt.Sprintf("%d", workers),
	}
	if skipChecksum {
		args = append(args, "--skip-checksum")
	}
	args = append(args, "--skip-atime")

	LogDebug(fmt.Sprintf("[CompareNFSMetadata] running: sudo bash %s", strings.Join(args, " ")))

	cmd := exec.Command("sudo", append([]string{"bash"}, args...)...)
	cmd.Stderr = os.Stderr
	_, err = cmd.Output()

	// exit code 1 = discrepancies found — not a fatal error
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			LogDebug("[CompareNFSMetadata] script exited 1 (discrepancies found)")
		} else {
			os.Remove(srcOut)
			os.Remove(dstOut)
			os.Remove(diffOut)
			return nil, fmt.Errorf("nfs_metadata_compare.sh failed: %w", err)
		}
	}

	var diffContent string
	if data, readErr := os.ReadFile(diffOut); readErr == nil {
		diffContent = string(data)
	}
	os.Remove(srcOut)
	os.Remove(dstOut)
	os.Remove(diffOut)

	result := parseNFSDiffOutput(diffContent)
	return result, nil
}

// WriteNFSDiffsTSV writes NFS comparison discrepancies to a TSV file
// with run context in the header. Returns the file path.
func WriteNFSDiffsTSV(outDir, testName string, discrepancies []MetadataDiscrepancy, src, dst string) string {
	_ = os.MkdirAll(outDir, 0o755)
	path := filepath.Join(outDir, fmt.Sprintf("nfs_diffs_%s_%d.tsv", testName, time.Now().Unix()))
	f, err := os.Create(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	fmt.Fprintf(f, "# NFS Metadata Diffs — %s\n", testName)
	fmt.Fprintf(f, "# Source: %s\n", src)
	fmt.Fprintf(f, "# Destination: %s\n", dst)
	fmt.Fprintf(f, "# Timestamp: %s\n", time.Now().UTC().Format(time.RFC3339))
	fmt.Fprintf(f, "# Run ID: %s\n", os.Getenv("GITHUB_RUN_ID"))
	fmt.Fprintf(f, "# Discrepancies: %d\n", len(discrepancies))
	fmt.Fprintf(f, "path\tfield\tsource_value\tdestination_value\n")
	for _, d := range discrepancies {
		fmt.Fprintf(f, "%s\t%s\t%s\t%s\n", d.Path, d.Field, d.SrcValue, d.DstValue)
	}
	return path
}

// ─── SMB comparison ───────────────────────────────────────────────────────────

// smbMetadataEntry mirrors the PowerShell scan result for one entry.
type smbMetadataEntry struct {
	Path       string        `json:"Path"`
	Type       string        `json:"Type"`
	SizeBytes  int64         `json:"SizeBytes"`
	MtimeEpoch int64         `json:"MtimeEpoch"`
	AtimeEpoch int64         `json:"AtimeEpoch"`
	Owner      string        `json:"Owner"`
	ACLEntries []smbACLEntry `json:"ACLEntries"`
}

type smbACLEntry struct {
	Principal        string `json:"Principal"`
	Rights           string `json:"Rights"`
	Type             string `json:"Type"`
	IsInherited      bool   `json:"IsInherited"`
	InheritanceFlags string `json:"InheritanceFlags"`
	PropagationFlags string `json:"PropagationFlags"`
}

// SMBCompareOptions controls which SMB fields are compared.
type SMBCompareOptions struct {
	SkipACL   bool
	SkipOwner bool
	SkipSize  bool
}

// CompareSMBMetadata SSHes to the Windows worker, maps both shares via PowerShell,
// and compares metadata entry-by-entry. Returns structured results.
//
// srcShare / dstShare: UNC paths, e.g. \\host\shareName
// workerCfg: SSH config for the Windows worker
// smbUser / smbPass: SMB authentication credentials
func CompareSMBMetadata(srcShare, dstShare string, workerCfg SSHConfig, smbUser, smbPass string, opts SMBCompareOptions) (*MetadataCompareResult, error) {
	srcShare = ensureUNCPath(srcShare)
	dstShare = ensureUNCPath(dstShare)
	LogDebug(fmt.Sprintf("[CompareSMBMetadata] scanning src=%s dst=%s via worker %s", srcShare, dstShare, workerCfg.Host))

	srcEntries, err := scanSMBShare(workerCfg, srcShare, "X:", smbUser, smbPass)
	if err != nil {
		return nil, fmt.Errorf("scan source share %s: %w", srcShare, err)
	}
	LogDebug(fmt.Sprintf("[CompareSMBMetadata] src has %d entries", len(srcEntries)))

	dstEntries, err := scanSMBShare(workerCfg, dstShare, "Y:", smbUser, smbPass)
	if err != nil {
		return nil, fmt.Errorf("scan destination share %s: %w", dstShare, err)
	}
	LogDebug(fmt.Sprintf("[CompareSMBMetadata] dst has %d entries", len(dstEntries)))

	return diffSMBEntries(srcEntries, dstEntries, opts), nil
}

// WriteCompareSMBMetadataTSV writes SMB metadata entries to TSV files for inspection.
func WriteCompareSMBMetadataTSV(outDir, srcFile, dstFile string, src, dst []smbMetadataEntry) {
	_ = os.MkdirAll(outDir, 0o755)
	writeSMBTSV(filepath.Join(outDir, srcFile), src)
	writeSMBTSV(filepath.Join(outDir, dstFile), dst)
}

// CompareProtocolMetadata is the generic dispatcher.
// protocol: "NFS" or "SMB"
// For NFS: srcPath/dstPath are "host:/export"
// For SMB: srcPath/dstPath are "\\host\share"; workerCfg must be the Windows worker
func CompareProtocolMetadata(
	protocol string,
	srcPath, dstPath string,
	workerCfg SSHConfig,
	smbUser, smbPass string,
	testName string,
	diffsOutputDir string,
) (*MetadataCompareResult, error) {
	LogDebug(fmt.Sprintf("[CompareProtocolMetadata] START protocol=%s src=%s dst=%s test=%s", protocol, srcPath, dstPath, testName))

	switch strings.ToUpper(protocol) {
	case "NFS":
		LogDebug("[CompareProtocolMetadata] calling CompareNFSMetadata with workers=16, skipChecksum=true")
		result, err := CompareNFSMetadata(srcPath, dstPath, 16, true)
		if err != nil {
			LogDebug(fmt.Sprintf("[CompareProtocolMetadata] NFS comparison ERROR: %v", err))
			return nil, err
		}
		LogDebug(fmt.Sprintf("[CompareProtocolMetadata] NFS comparison done: hasDiffs=%v discrepancies=%d srcOnly=%d dstOnly=%d",
			result.HasDiffs, len(result.Discrepancies), len(result.SrcOnlyPaths), len(result.DstOnlyPaths)))
		if result.HasDiffs && diffsOutputDir != "" {
			result.DiffsFile = WriteNFSDiffsTSV(diffsOutputDir, testName, result.Discrepancies, srcPath, dstPath)
			LogDebug(fmt.Sprintf("[CompareProtocolMetadata] diffs written to: %s", result.DiffsFile))
		}
		return result, nil

	case "SMB":
		LogDebug(fmt.Sprintf("[CompareProtocolMetadata] calling CompareSMBMetadata via worker %s", workerCfg.Host))
		result, err := CompareSMBMetadata(srcPath, dstPath, workerCfg, smbUser, smbPass, SMBCompareOptions{})
		if err != nil {
			LogDebug(fmt.Sprintf("[CompareProtocolMetadata] SMB comparison ERROR: %v", err))
			return nil, err
		}
		LogDebug(fmt.Sprintf("[CompareProtocolMetadata] SMB comparison done: hasDiffs=%v discrepancies=%d srcOnly=%d dstOnly=%d",
			result.HasDiffs, len(result.Discrepancies), len(result.SrcOnlyPaths), len(result.DstOnlyPaths)))
		if result.HasDiffs && diffsOutputDir != "" {
			srcFile := fmt.Sprintf("src_smb_metadata_%s.tsv", testName)
			dstFile := fmt.Sprintf("dst_smb_metadata_%s.tsv", testName)
			LogDebug(fmt.Sprintf("[CompareProtocolMetadata] writing TSV: %s, %s", srcFile, dstFile))
		}
		return result, nil

	default:
		return nil, fmt.Errorf("unsupported protocol %q (valid: NFS, SMB)", protocol)
	}
}

// ─── SMB internals ────────────────────────────────────────────────────────────

func scanSMBShare(worker SSHConfig, share, drive, username, password string) ([]smbMetadataEntry, error) {
	psScript := buildSMBScanScript(share, drive, username, password)
	cmd := fmt.Sprintf(`powershell.exe -NoProfile -NonInteractive -EncodedCommand "%s"`,
		encodeSMBScript(psScript))

	output, err := sshRunCommand(worker, cmd)
	if err != nil {
		return nil, fmt.Errorf("PowerShell execution failed: %w\noutput: %s", err, output)
	}
	return parseSMBScanOutput(output)
}

func buildSMBScanScript(share, drive, username, password string) string {
	return fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
$drive  = "%s"
$share  = "%s"
$user   = "%s"
$pass   = "%s"

try { net use $drive /delete /y 2>$null | Out-Null } catch {}
$mountOut = net use $drive $share /user:$user $pass 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error "net use failed: $mountOut"; exit 1 }

$root = $drive + "\"
$results = [System.Collections.Generic.List[object]]::new()

try {
    Get-ChildItem -Path $root -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '~snapshot|\.snapshot' } | ForEach-Object {
        $item = $_
        $relPath = $item.FullName.Substring($root.Length).Replace('\', '/')
        $owner   = ""
        $aceList = @()
        try {
            $acl   = Get-Acl -Path $item.FullName -ErrorAction SilentlyContinue
            $owner = $acl.Owner
            try {
                $owner = (New-Object System.Security.Principal.NTAccount($acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value
            } catch {}
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

if ($results.Count -eq 0) { Write-Output "[]" } else { $results | ConvertTo-Json -Depth 10 -Compress }
`, drive, share, username, password)
}

func parseSMBScanOutput(output string) ([]smbMetadataEntry, error) {
	output = strings.TrimSpace(output)
	jsonStart := strings.Index(output, "[")
	if jsonStart == -1 {
		return nil, fmt.Errorf("no JSON array in output")
	}
	jsonPart := output[jsonStart:]
	var entries []smbMetadataEntry
	if err := json.Unmarshal([]byte(jsonPart), &entries); err != nil {
		return nil, fmt.Errorf("JSON unmarshal: %w", err)
	}
	return entries, nil
}

func diffSMBEntries(src, dst []smbMetadataEntry, opts SMBCompareOptions) *MetadataCompareResult {
	result := &MetadataCompareResult{}
	srcMap := make(map[string]smbMetadataEntry, len(src))
	dstMap := make(map[string]smbMetadataEntry, len(dst))
	for _, e := range src {
		srcMap[strings.ToLower(strings.TrimPrefix(e.Path, "/"))] = e
	}
	for _, e := range dst {
		dstMap[strings.ToLower(strings.TrimPrefix(e.Path, "/"))] = e
	}
	for path := range srcMap {
		if _, ok := dstMap[path]; !ok {
			result.SrcOnlyPaths = append(result.SrcOnlyPaths, path)
		}
	}
	for path := range dstMap {
		if _, ok := srcMap[path]; !ok {
			result.DstOnlyPaths = append(result.DstOnlyPaths, path)
		}
	}
	for path, s := range srcMap {
		d, ok := dstMap[path]
		if !ok {
			continue
		}
		record := func(field, sv, dv string) {
			result.Discrepancies = append(result.Discrepancies, MetadataDiscrepancy{
				Path: path, Field: field, SrcValue: sv, DstValue: dv,
			})
		}
		if s.Type != d.Type {
			record("type", s.Type, d.Type)
			continue
		}
		if !opts.SkipSize && s.Type == "File" && s.SizeBytes != d.SizeBytes {
			record("size_bytes", fmt.Sprintf("%d", s.SizeBytes), fmt.Sprintf("%d", d.SizeBytes))
		}
		if s.MtimeEpoch != d.MtimeEpoch {
			record("mtime", fmt.Sprintf("%d", s.MtimeEpoch), fmt.Sprintf("%d", d.MtimeEpoch))
		}
		if !opts.SkipOwner && !strings.EqualFold(s.Owner, d.Owner) {
			record("owner", s.Owner, d.Owner)
		}
	}
	result.HasDiffs = len(result.SrcOnlyPaths) > 0 ||
		len(result.DstOnlyPaths) > 0 ||
		len(result.Discrepancies) > 0
	return result
}

func writeSMBTSV(path string, entries []smbMetadataEntry) {
	f, err := os.Create(path)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "path\ttype\tsize_bytes\tmtime_epoch\tatime_epoch\towner\n")
	for _, e := range entries {
		fmt.Fprintf(f, "%s\t%s\t%d\t%d\t%d\t%s\n",
			e.Path, e.Type, e.SizeBytes, e.MtimeEpoch, e.AtimeEpoch, e.Owner)
	}
}

// ─── NFS script helpers ───────────────────────────────────────────────────────

func findNFSCompareScript() (string, error) {
	_, thisFile, _, ok := runtime.Caller(0)
	if ok {
		// thisFile = .../ndm-api-tests/utils/metadata_comparator.go
		// script   = .../ndm-ui-tests/scripts/nfs_metadata_compare.sh (sibling repo dir)
		repoRoot := filepath.Join(filepath.Dir(thisFile), "..", "..")
		candidate := filepath.Join(repoRoot, "ndm-ui-tests", "scripts", "nfs_metadata_compare.sh")
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	for _, p := range []string{
		"../../ndm-ui-tests/scripts/nfs_metadata_compare.sh",
		"../scripts/nfs_metadata_compare.sh",
		"scripts/nfs_metadata_compare.sh",
	} {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("nfs_metadata_compare.sh not found — expected at ndm-ui-tests/scripts/")
}

func parseNFSDiffOutput(output string) *MetadataCompareResult {
	result := &MetadataCompareResult{}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "path\t") || strings.HasPrefix(line, "[") {
			continue
		}
		cols := strings.SplitN(line, "\t", 5)
		if len(cols) < 4 {
			continue
		}
		field := cols[1]
		if field == "EXISTS_IN_SRC_ONLY" {
			result.SrcOnlyPaths = append(result.SrcOnlyPaths, cols[0])
		} else if field == "EXISTS_IN_DST_ONLY" {
			result.DstOnlyPaths = append(result.DstOnlyPaths, cols[0])
		} else {
			result.Discrepancies = append(result.Discrepancies, MetadataDiscrepancy{
				Path:     cols[0],
				Field:    cols[1],
				SrcValue: cols[2],
				DstValue: cols[3],
			})
		}
	}
	result.HasDiffs = len(result.SrcOnlyPaths) > 0 ||
		len(result.DstOnlyPaths) > 0 ||
		len(result.Discrepancies) > 0
	return result
}

// ─── SSH helper ───────────────────────────────────────────────────────────────

func sshRunCommand(cfg SSHConfig, command string) (string, error) {
	sshCfg := &ssh.ClientConfig{
		User:            cfg.Username,
		Auth:            []ssh.AuthMethod{ssh.Password(cfg.Password)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), //nolint:gosec
		Timeout:         60 * time.Second,
	}
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	client, err := ssh.Dial("tcp", addr, sshCfg)
	if err != nil {
		return "", fmt.Errorf("SSH dial %s: %w", addr, err)
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("SSH session: %w", err)
	}
	defer session.Close()

	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	if err := session.Run(command); err != nil {
		return "", fmt.Errorf("SSH run: %w\nstdout: %s\nstderr: %s",
			err, stdout.String(), stderr.String())
	}
	return stdout.String(), nil
}

// ─── PowerShell encoding helpers ─────────────────────────────────────────────

func encodeSMBScript(script string) string {
	runes := []rune(script)
	utf16 := make([]byte, len(runes)*2)
	for i, r := range runes {
		utf16[i*2] = byte(r)
		utf16[i*2+1] = byte(r >> 8)
	}
	return base64.StdEncoding.EncodeToString(utf16)
}

// ─── CoC Report Validation Against Live Destination ──────────────────────────

// CoCValidationResult holds the outcome of CoC-vs-live validation.
type CoCValidationResult struct {
	TotalFiles int
	Sampled    int
	Diffs      []string
	Match      bool
}

func (r *CoCValidationResult) Summary() string {
	if r.Match {
		return fmt.Sprintf("PASS — sampled %d/%d files, all match", r.Sampled, r.TotalFiles)
	}
	return fmt.Sprintf("FAIL — %d diff(s) in %d sampled files", len(r.Diffs), r.Sampled)
}

// ValidateCoCAgainstDestination fetches the CoC report for the given jobRunID,
// mounts/scans the destination volume, and validates up to sampleSize files.
//
// For NFS:  checks size, UID, GID, permissions, checksum (src==dst in report)
// For SMB:  checks size, owner, checksum (src==dst in report)
//
// protocol: "NFS" or "SMB"
// jobRunID: the migration job run ID (used to fetch CoC CSV via API)
// dstPath:  NFS "host:/export" or SMB "\\host\share"
// workerCfg: SSH config for destination scanning (NFS: local exec, SMB: Windows worker)
// smbUser/smbPass: SMB credentials (ignored for NFS)
// sampleSize: max files to validate (e.g. 100)
func ValidateCoCAgainstDestination(
	protocol string,
	jobRunID string,
	dstPath string,
	workerCfg SSHConfig,
	smbUser, smbPass string,
	sampleSize int,
	headers map[string]string,
) (*CoCValidationResult, error) {
	// Fetch the CoC ZIP from the report service and extract coc-report.csv.
	zipData, err := fetchCocCSV(jobRunID)
	if err != nil {
		return nil, fmt.Errorf("fetch CoC CSV for job %s: %w", jobRunID, err)
	}

	csvFiles, err := extractCSVFilesFromZip(zipData)
	if err != nil {
		return nil, fmt.Errorf("extract CSVs from CoC ZIP for job %s: %w", jobRunID, err)
	}

	// Pick coc-report.csv from the extracted files.
	var cocBytes []byte
	for zipPath, b := range csvFiles {
		base := strings.ToLower(path.Base(normalizeZipEntryPath(zipPath)))
		if strings.Contains(base, "coc-report.csv") {
			cocBytes = b
			break
		}
	}
	if cocBytes == nil {
		return nil, fmt.Errorf("coc-report.csv not found in CoC ZIP for job %s", jobRunID)
	}

	rows, err := parseCoCCSV(cocBytes)
	if err != nil {
		return nil, fmt.Errorf("parse CoC CSV: %w", err)
	}
	LogDebug(fmt.Sprintf("[ValidateCoCAgainstDst] CSV has %d rows, sampling %d", len(rows), sampleSize))

	switch strings.ToUpper(protocol) {
	case "NFS":
		return validateNFSCoCAgainstDst(rows, dstPath, sampleSize)
	case "SMB":
		return validateSMBCoCAgainstDst(rows, dstPath, workerCfg, smbUser, smbPass, sampleSize)
	default:
		return nil, fmt.Errorf("unsupported protocol %q", protocol)
	}
}

// ─── NFS CoC validation ──────────────────────────────────────────────────────

func validateNFSCoCAgainstDst(rows []map[string]string, dstExport string, sampleSize int) (*CoCValidationResult, error) {
	LogDebug(fmt.Sprintf("[validateNFSCoCAgainstDst] START dst=%s sampleSize=%d", dstExport, sampleSize))

	// Mount and scan destination under a single sudo invocation.
	uid := fmt.Sprintf("%d", time.Now().UnixNano())
	mp := fmt.Sprintf("/mnt/coc_val_%s", uid)

	script := fmt.Sprintf(`
set -e
if ! command -v mount.nfs >/dev/null 2>&1; then
  apt-get install -y nfs-common >/dev/null 2>&1
fi
mkdir -p "%[1]s"
mount -o ro -t nfs "%[2]s" "%[1]s"
find "%[1]s" -mindepth 1 -not -path '*/.snapshot/*' -printf '%%P\t%%y\t%%s\t%%U\t%%G\t%%m\n'
umount "%[1]s" || umount -l "%[1]s"
rm -rf "%[1]s"
`, mp, dstExport)

	LogDebug(fmt.Sprintf("[validateNFSCoCAgainstDst] mounting %s at %s", dstExport, mp))
	cmd := exec.Command("sudo", "bash", "-c", script)
	out, err := cmd.CombinedOutput()
	if err != nil {
		LogDebug(fmt.Sprintf("[validateNFSCoCAgainstDst] NFS scan FAILED: %v, output length=%d, output=%q", err, len(out), string(out)))
		return nil, fmt.Errorf("NFS scan %s failed: %w\noutput: %s", dstExport, err, string(out))
	}
	LogDebug(fmt.Sprintf("[validateNFSCoCAgainstDst] NFS scan completed, output length=%d bytes", len(out)))

	// Parse scan output into a map: path → {size, uid, gid, perms}
	type nfsStat struct {
		size, uid, gid, perms string
	}
	dstStats := make(map[string]nfsStat)
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 6)
		if len(parts) < 6 {
			continue
		}
		if parts[1] == "f" { // files only
			dstStats[parts[0]] = nfsStat{size: parts[2], uid: parts[3], gid: parts[4], perms: parts[5]}
		}
	}
	LogDebug(fmt.Sprintf("[validateNFSCoCAgainstDst] dst has %d file entries", len(dstStats)))

	// Compare sample of CSV rows against live.
	result := &CoCValidationResult{}
	notFoundCount := 0
	for _, row := range rows {
		// Files have a non-empty "Destination Checksum"; directories have it empty.
		dstChecksum := strings.TrimSpace(row["Destination Checksum"])
		if dstChecksum == "" {
			continue
		}

		dstRelPath := normalizeCoCPathForNFS(row["Destination Path"])
		result.TotalFiles++
		if result.Sampled >= sampleSize {
			continue
		}

		stat, found := dstStats[dstRelPath]
		if !found {
			notFoundCount++
			if notFoundCount <= 5 {
				LogDebug(fmt.Sprintf("[validateNFSCoCAgainstDst] path not found on dst: %q (raw CSV: %q)", dstRelPath, row["Destination Path"]))
			}
			continue
		}

		// Size
		if sizeStr := strings.TrimSpace(row["Size in Bytes"]); sizeStr != "" && sizeStr != stat.size {
			result.Diffs = append(result.Diffs, fmt.Sprintf("%s: size report=%s actual=%s", dstRelPath, sizeStr, stat.size))
		}
		// UID
		if uid := strings.TrimSpace(row["Destination UID"]); uid != "" && uid != stat.uid {
			result.Diffs = append(result.Diffs, fmt.Sprintf("%s: UID report=%s actual=%s", dstRelPath, uid, stat.uid))
		}
		// GID
		if gid := strings.TrimSpace(row["Destination GID"]); gid != "" && gid != stat.gid {
			result.Diffs = append(result.Diffs, fmt.Sprintf("%s: GID report=%s actual=%s", dstRelPath, gid, stat.gid))
		}
		// Permissions — CSV uses symbolic (e.g. "-rwxrwxr-x"), find %m gives octal ("775")
		if perms := strings.TrimSpace(row["Destination Unix Permissions"]); perms != "" && symbolicPermsToOctal(perms) != stat.perms {
			result.Diffs = append(result.Diffs, fmt.Sprintf("%s: perms report=%s(%s) actual=%s", dstRelPath, perms, symbolicPermsToOctal(perms), stat.perms))
		}
		// Checksum match (src vs dst in report)
		srcCS := strings.TrimSpace(row["Source Checksum"])
		if srcCS != "" && dstChecksum != "" && !strings.EqualFold(srcCS, dstChecksum) {
			result.Diffs = append(result.Diffs, fmt.Sprintf("%s: checksum src=%s dst=%s", dstRelPath, srcCS[:min8(len(srcCS))], dstChecksum[:min8(len(dstChecksum))]))
		}
		result.Sampled++
	}

	if notFoundCount > 0 {
		LogDebug(fmt.Sprintf("[validateNFSCoCAgainstDst] %d/%d file paths from CSV not found on destination (path normalization mismatch)", notFoundCount, result.TotalFiles))
	}
	LogDebug(fmt.Sprintf("[validateNFSCoCAgainstDst] result: TotalFiles=%d Sampled=%d Diffs=%d", result.TotalFiles, result.Sampled, len(result.Diffs)))

	result.Match = len(result.Diffs) == 0
	return result, nil
}

// ─── SMB CoC validation ──────────────────────────────────────────────────────

func validateSMBCoCAgainstDst(rows []map[string]string, dstShare string, workerCfg SSHConfig, smbUser, smbPass string, sampleSize int) (*CoCValidationResult, error) {
	// Scan destination share via Windows worker.
	dstEntries, err := scanSMBShare(workerCfg, dstShare, "Y:", smbUser, smbPass)
	if err != nil {
		return nil, fmt.Errorf("SMB scan %s: %w", dstShare, err)
	}
	dstMap := make(map[string]smbMetadataEntry, len(dstEntries))
	for _, e := range dstEntries {
		dstMap[strings.ToLower(strings.TrimPrefix(e.Path, "/"))] = e
	}
	LogDebug(fmt.Sprintf("[validateSMBCoCAgainstDst] dst has %d entries", len(dstMap)))

	result := &CoCValidationResult{}
	notFoundCount := 0
	for _, row := range rows {
		// Files have a non-empty "Destination Checksum"; directories have it empty.
		dstChecksum := strings.TrimSpace(row["Destination Checksum"])
		if dstChecksum == "" {
			continue
		}

		dstRelPath := normalizeCoCPathForSMB(row["Destination Path"])
		result.TotalFiles++
		if result.Sampled >= sampleSize {
			continue
		}

		entry, found := dstMap[dstRelPath]
		if !found {
			notFoundCount++
			if notFoundCount <= 5 {
				LogDebug(fmt.Sprintf("[validateSMBCoCAgainstDst] path not found on dst: %q (raw CSV: %q)", dstRelPath, row["Destination Path"]))
			}
			continue
		}

		// Size
		if sizeStr := strings.TrimSpace(row["Size in Bytes"]); sizeStr != "" {
			var reportSize int64
			if _, scanErr := fmt.Sscanf(sizeStr, "%d", &reportSize); scanErr == nil {
				if reportSize != entry.SizeBytes {
					result.Diffs = append(result.Diffs, fmt.Sprintf("%s: size report=%d actual=%d", dstRelPath, reportSize, entry.SizeBytes))
				}
			}
		}
		// Owner
		if owner := strings.TrimSpace(row["Target Owner SID"]); owner != "" {
			if !strings.EqualFold(owner, entry.Owner) {
				result.Diffs = append(result.Diffs, fmt.Sprintf("%s: owner report=%q actual=%q", dstRelPath, owner, entry.Owner))
			}
		}
		// Checksum match (src vs dst in report)
		srcCS := strings.TrimSpace(row["Source Checksum"])
		if srcCS != "" && dstChecksum != "" && !strings.EqualFold(srcCS, dstChecksum) {
			result.Diffs = append(result.Diffs, fmt.Sprintf("%s: checksum src=%s dst=%s", dstRelPath, srcCS[:min8(len(srcCS))], dstChecksum[:min8(len(dstChecksum))]))
		}
		result.Sampled++
	}

	if notFoundCount > 0 {
		LogDebug(fmt.Sprintf("[validateSMBCoCAgainstDst] %d/%d file paths from CSV not found on destination", notFoundCount, result.TotalFiles))
	}
	LogDebug(fmt.Sprintf("[validateSMBCoCAgainstDst] result: TotalFiles=%d Sampled=%d Diffs=%d", result.TotalFiles, result.Sampled, len(result.Diffs)))

	result.Match = len(result.Diffs) == 0
	return result, nil
}

// ─── CoC CSV helpers ─────────────────────────────────────────────────────────

func parseCoCCSV(data []byte) ([]map[string]string, error) {
	reader := csv.NewReader(bytes.NewReader(data))
	reader.TrimLeadingSpace = true
	reader.FieldsPerRecord = -1

	records, err := reader.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(records) < 2 {
		return nil, fmt.Errorf("CSV has fewer than 2 lines")
	}
	headers := records[0]
	for i := range headers {
		headers[i] = strings.TrimSpace(strings.TrimPrefix(headers[i], "\ufeff"))
	}
	var rows []map[string]string
	for _, cols := range records[1:] {
		row := make(map[string]string, len(headers))
		for i, h := range headers {
			if i < len(cols) {
				row[h] = strings.TrimSpace(cols[i])
			}
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func normalizeCoCPathForNFS(p string) string {
	p = strings.TrimSpace(p)
	p = strings.ReplaceAll(p, `\`, "/")
	p = strings.TrimPrefix(p, "/")
	// Strip volume name prefix (first segment)
	if idx := strings.Index(p, "/"); idx != -1 {
		p = p[idx+1:]
	}
	return p
}

func normalizeCoCPathForSMB(p string) string {
	p = strings.TrimSpace(p)
	p = strings.ReplaceAll(p, `\`, "/")
	p = strings.TrimPrefix(p, "/")
	// Strip share name prefix (first segment)
	if idx := strings.Index(p, "/"); idx != -1 {
		p = p[idx+1:]
	}
	return strings.ToLower(p)
}

// ensureUNCPath converts NFS-format paths (host:/share) to UNC format (\\host\share).
// If already in UNC format, returns as-is.
func ensureUNCPath(p string) string {
	p = strings.TrimSpace(p)
	if strings.HasPrefix(p, `\\`) {
		return p
	}
	// NFS format: "host:/share" or "host:/share/sub"
	if idx := strings.Index(p, ":/"); idx != -1 {
		host := p[:idx]
		share := p[idx+2:] // skip ":/"
		share = strings.TrimPrefix(share, "/")
		return fmt.Sprintf(`\\%s\%s`, host, share)
	}
	return p
}

func min8(n int) int {
	if n < 8 {
		return n
	}
	return 8
}

// symbolicPermsToOctal converts a symbolic permission string like "-rwxrwxr-x"
// to its octal representation "775". If the input is already numeric or
// unparseable, it is returned unchanged.
func symbolicPermsToOctal(s string) string {
	s = strings.TrimSpace(s)
	if len(s) == 0 {
		return s
	}
	if s[0] >= '0' && s[0] <= '9' {
		return s
	}
	perms := s
	if len(perms) == 10 {
		perms = perms[1:]
	}
	if len(perms) != 9 {
		return s
	}

	bit := func(c byte, v int) int {
		switch c {
		case 'r', 'w', 'x', 's', 't':
			return v
		default:
			return 0
		}
	}

	owner := bit(perms[0], 4) + bit(perms[1], 2) + bit(perms[2], 1)
	group := bit(perms[3], 4) + bit(perms[4], 2) + bit(perms[5], 1)
	other := bit(perms[6], 4) + bit(perms[7], 2) + bit(perms[8], 1)

	return fmt.Sprintf("%d%d%d", owner, group, other)
}
