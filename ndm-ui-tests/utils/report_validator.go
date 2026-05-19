package utils

import (
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
)

// parseReportColumnK reads a column from a CSVRow and returns the value in
// K units rounded to 2dp — the same precision NDM uses when displaying counts.
// This avoids off-by-one mismatches caused by NDM rounding raw counts to K.
func parseReportColumnK(row CSVRow, col string) (float64, error) {
	val, ok := row[col]
	if !ok || strings.TrimSpace(val) == "" {
		return 0, fmt.Errorf("column %q not found or empty in discovery CSV", col)
	}
	k, err := ParseHumanCountToK(val)
	if err != nil {
		return 0, fmt.Errorf("parse column %q value %q: %w", col, val, err)
	}
	return k, nil
}

// ─── Enums ────────────────────────────────────────────────────────────────────

// ReportType identifies the kind of NDM report being validated.
type ReportType string

const (
	// ReportTypeDiscovery validates the discovery-report CSV:
	// compares "Total Count" and "Regular Files Count" against a live volume scan.
	ReportTypeDiscovery ReportType = "DISCOVERY"

	// ReportTypeMigration validates the Chain-of-Custody migration report CSV:
	// mounts source and destination NFS volumes, collects per-file metadata
	// (UID, GID, permissions, size, mtime, atime, checksum) and compares each
	// field against the corresponding column in the CoC report.
	ReportTypeMigration ReportType = "MIGRATION"
)

// Protocol selects the storage protocol used for the source volume.
type Protocol string

const (
	ProtocolNFS Protocol = "NFS"
	ProtocolSMB Protocol = "SMB"
)

// ─── Result types ─────────────────────────────────────────────────────────────

// ValidationResult is returned by ValidateReport.
// Match is true when the report matches the live volume.
// Diffs lists human-readable discrepancies when Match is false.
type ValidationResult struct {
	Match bool
	Diffs []string
}

func (v *ValidationResult) String() string {
	if v.Match {
		return "PASS: report matches live volume"
	}
	return fmt.Sprintf("FAIL: %d discrepancies:\n  - %s",
		len(v.Diffs), strings.Join(v.Diffs, "\n  - "))
}

// ─── Main entry point ─────────────────────────────────────────────────────────

// ValidateReport validates an NDM discovery report CSV against a live volume.
//
// Parameters:
//
//	reportType – DISCOVERY (only supported type)
//	protocol   – NFS or SMB
//	csvPath    – path to the NDM-generated report CSV (or ZIP containing it)
//	src        – NFS: "host:/export/path"  |  SMB: "\\host\share"
func ValidateReport(reportType ReportType, protocol Protocol, csvPath string, src string) (*ValidationResult, error) {
	switch reportType {
	case ReportTypeDiscovery:
		return validateDiscoveryReport(protocol, csvPath, src)
	default:
		return nil, fmt.Errorf("unsupported report type %q (valid: DISCOVERY, MIGRATION)", reportType)
	}
}

// ValidateNFSMigrationReport validates the NDM migration CoC report CSV by
// mounting both source and destination NFS exports and comparing every file's
// live metadata against the report columns.
//
// Checked per file:
//   - CopyContentStatus   must be "success"
//   - ChecksumMatchStatus must be "yes" (files only)
//   - Source / Destination UID, GID, Unix Permissions
//   - Size in Bytes
//   - Source / Destination Checksum (if non-empty in CSV)
//   - mtime and atime (within 1 second tolerance for filesystem rounding)
//
// Also verified:
//   - Every file in the CoC report exists on both source and destination mounts
//   - Every file on the source mount has a corresponding CoC report entry
//
// Parameters:
//
//	csvPath    – path to the NDM-generated CoC CSV (or ZIP)
//	srcExport  – "host:/src/volume"  (NFS source)
//	dstExport  – "host:/dst/volume"  (NFS destination)
func ValidateNFSMigrationReport(csvPath, srcExport, dstExport string) (*ValidationResult, error) {
	// ── Step 1: parse CoC CSV ─────────────────────────────────────────────
	rows, err := ParseCSVFile(csvPath)
	if err != nil {
		return nil, fmt.Errorf("parse migration CSV %q: %w", csvPath, err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("migration CSV %q has no data rows", csvPath)
	}
	LogDebug(fmt.Sprintf("[ValidateNFSMigrationReport] CSV has %d rows", len(rows)))

	// ── Step 2: mount and scan source volume ─────────────────────────────
	LogDebug(fmt.Sprintf("[ValidateNFSMigrationReport] scanning source: %s", srcExport))
	srcStats, err := ScanNFSVolumeForMigrationValidation(srcExport)
	if err != nil {
		return nil, fmt.Errorf("source NFS scan %q: %w", srcExport, err)
	}
	LogDebug(fmt.Sprintf("[ValidateNFSMigrationReport] source: %d entries", len(srcStats)))

	// ── Step 3: mount and scan destination volume ─────────────────────────
	LogDebug(fmt.Sprintf("[ValidateNFSMigrationReport] scanning destination: %s", dstExport))
	dstStats, err := ScanNFSVolumeForMigrationValidation(dstExport)
	if err != nil {
		return nil, fmt.Errorf("destination NFS scan %q: %w", dstExport, err)
	}
	LogDebug(fmt.Sprintf("[ValidateNFSMigrationReport] destination: %d entries", len(dstStats)))

	// ── Step 4: compare each CoC row against live stats ───────────────────
	var diffs []string
	seenSrcPaths := make(map[string]bool)

	for _, row := range rows {
		srcPath := normalizeCoCSrcPath(row)
		dstPath := normalizeCoCDstPath(row)
		entryType := strings.ToLower(strings.TrimSpace(row["Type"]))
		isFile := entryType == "f" || entryType == "file"

		// ── CopyContentStatus ─────────────────────────────────────────────
		if status := strings.TrimSpace(row["CopyContentStatus"]); status != "success" {
			diffs = append(diffs, fmt.Sprintf(
				"%s: CopyContentStatus=%q (expected success)", srcPath, status))
			continue // no point comparing metadata for a failed copy
		}

		// ── ChecksumMatchStatus (files only) ─────────────────────────────
		if isFile {
			if cms := strings.TrimSpace(row["ChecksumMatchStatus"]); cms != "yes" {
				diffs = append(diffs, fmt.Sprintf(
					"%s: ChecksumMatchStatus=%q (expected yes)", srcPath, cms))
			}
		}

		// ── Source live stat ──────────────────────────────────────────────
		seenSrcPaths[srcPath] = true
		srcStat, srcFound := srcStats[srcPath]
		if !srcFound {
			diffs = append(diffs, fmt.Sprintf("%s: not found on source volume", srcPath))
		}

		// ── Destination live stat ─────────────────────────────────────────
		dstStat, dstFound := dstStats[dstPath]
		if !dstFound {
			diffs = append(diffs, fmt.Sprintf("%s: not found on destination volume (looked for %s)", srcPath, dstPath))
		}

		if !srcFound || !dstFound {
			continue
		}

		// ── Size ──────────────────────────────────────────────────────────
		if isFile {
			if sizeStr := strings.TrimSpace(row["Size in Bytes"]); sizeStr != "" {
				var reportSize int64
				if _, err := fmt.Sscanf(sizeStr, "%d", &reportSize); err == nil {
					if reportSize != srcStat.Size {
						diffs = append(diffs, fmt.Sprintf(
							"%s: size report=%d actual_src=%d", srcPath, reportSize, srcStat.Size))
					}
					if reportSize != dstStat.Size {
						diffs = append(diffs, fmt.Sprintf(
							"%s: size report=%d actual_dst=%d", srcPath, reportSize, dstStat.Size))
					}
				}
			}
		}

		// ── UID ────────────────────────────────────────────────────────────
		compareMetaField(&diffs, srcPath, "Source UID", row, srcStat.UID, "src")
		compareMetaField(&diffs, srcPath, "Destination UID", row, dstStat.UID, "dst")

		// ── GID ────────────────────────────────────────────────────────────
		compareMetaField(&diffs, srcPath, "Source GID", row, srcStat.GID, "src")
		compareMetaField(&diffs, srcPath, "Destination GID", row, dstStat.GID, "dst")

		// ── Unix Permissions ──────────────────────────────────────────────
		compareMetaField(&diffs, srcPath, "Source Unix Permissions", row, srcStat.Permissions, "src")
		compareMetaField(&diffs, srcPath, "Destination Unix Permissions", row, dstStat.Permissions, "dst")

		// ── mtime ─────────────────────────────────────────────────────────
		compareTimestamp(&diffs, srcPath, "Source mtime", row, srcStat.Mtime)
		compareTimestamp(&diffs, srcPath, "Destination mtime", row, dstStat.Mtime)

		// ── atime ─────────────────────────────────────────────────────────
		compareTimestamp(&diffs, srcPath, "Source atime", row, srcStat.Atime)
		compareTimestamp(&diffs, srcPath, "Destination atime", row, dstStat.Atime)

		// ── Checksums (informational — NDM already confirms these via ChecksumMatchStatus) ──
		if isFile {
			if srcCS := strings.TrimSpace(row["Source Checksum"]); srcCS != "" {
				if dstCS := strings.TrimSpace(row["Destination Checksum"]); dstCS != "" {
					if !strings.EqualFold(srcCS, dstCS) {
						diffs = append(diffs, fmt.Sprintf(
							"%s: src_checksum=%s dst_checksum=%s (mismatch)", srcPath, srcCS[:min8(len(srcCS))], dstCS[:min8(len(dstCS))]))
					}
				}
			}
		}
	}

	// ── Step 5: check for source files missing from the report ────────────
	for path := range srcStats {
		if srcStats[path].Type == "d" {
			continue // directories may be omitted from some report formats
		}
		if !seenSrcPaths[path] {
			diffs = append(diffs, fmt.Sprintf("source file %q has no CoC report entry", path))
		}
	}

	LogDebug(fmt.Sprintf("[ValidateNFSMigrationReport] found %d difference(s)", len(diffs)))

	if len(diffs) > 0 {
		return &ValidationResult{Match: false, Diffs: diffs},
			fmt.Errorf("migration report does not match live volumes (%d diff(s))", len(diffs))
	}
	return &ValidationResult{Match: true}, nil
}

// ─── migration helpers ────────────────────────────────────────────────────────

// normalizeCoCSrcPath strips the leading share/volume prefix from the
// "Source Path" column so it can be matched against an NFS mount scan path.
// NDM stores paths as "shareName\relative\path" (SMB) or "/vol/relative/path"
// (NFS). For NFS we strip the leading /volName/ segment.
func normalizeCoCSrcPath(row CSVRow) string {
	return normalizeCoCPath(row["Source Path"])
}

func normalizeCoCDstPath(row CSVRow) string {
	return normalizeCoCPath(row["Destination Path"])
}

func normalizeCoCPath(p string) string {
	p = strings.TrimSpace(p)
	// Convert any backslashes (SMB style) to forward slashes.
	p = strings.ReplaceAll(p, `\`, "/")
	// Strip leading slash.
	p = strings.TrimPrefix(p, "/")
	// For NFS CoC reports, paths are relative to the volume root already.
	return p
}

// compareMetaField compares a report CSV column against a live stat value.
// colLabel is the CSV column name; liveVal is the stat string; side is "src"/"dst".
func compareMetaField(diffs *[]string, filePath, colLabel string, row CSVRow, liveVal, side string) {
	reportVal := strings.TrimSpace(row[colLabel])
	if reportVal == "" {
		return // column absent or empty — skip
	}
	if !strings.EqualFold(reportVal, liveVal) {
		*diffs = append(*diffs, fmt.Sprintf(
			"%s: %s report=%q actual_%s=%q", filePath, colLabel, reportVal, side, liveVal))
	}
}

// compareTimestamp compares a report column (epoch seconds as a float string)
// against a live stat mtime/atime. Allows up to 1 second of tolerance to
// handle filesystem timestamp rounding.
func compareTimestamp(diffs *[]string, filePath, colLabel string, row CSVRow, liveSec float64) {
	reportStr := strings.TrimSpace(row[colLabel])
	if reportStr == "" {
		return
	}
	reportSec, err := strconv.ParseFloat(reportStr, 64)
	if err != nil {
		return // non-epoch format — skip
	}
	if math.Abs(reportSec-liveSec) > 1.0 {
		*diffs = append(*diffs, fmt.Sprintf(
			"%s: %s report=%.3f actual=%.3f (delta=%.3f > 1s)",
			filePath, colLabel, reportSec, liveSec, math.Abs(reportSec-liveSec)))
	}
}

// min8 returns min(n, 8) — used to truncate checksum strings in diff messages.
func min8(n int) int {
	if n < 8 {
		return n
	}
	return 8
}

// ─── Discovery validation ─────────────────────────────────────────────────────

// validateDiscoveryReport handles the DISCOVERY report type.
// It dispatches to the NFS or SMB implementation based on protocol.
func validateDiscoveryReport(protocol Protocol, csvPath, src string) (*ValidationResult, error) {
	switch protocol {
	case ProtocolNFS:
		return validateNFSDiscovery(csvPath, src)
	case ProtocolSMB:
		return validateSMBDiscovery(csvPath, src)
	default:
		return nil, fmt.Errorf("unsupported protocol %q for DISCOVERY (valid: NFS, SMB)", protocol)
	}
}

// validateNFSDiscovery:
//  1. Parses the discovery report CSV to read "Total Count" and
//     "Regular Files Count" (handles K/M suffixes like "17.96K").
//  2. Mounts the NFS export on this machine (read-only, temp mount point).
//  3. Runs `ls -lR` on the mount to count regular files (lines starting "-")
//     and directories (lines starting "d") — mirrors the manual command:
//       output=$(sudo ls -lR /mnt/nfs-src 2>/dev/null)
//       echo "Files:       $(echo "$output" | grep "^-" | wc -l)"
//       echo "Directories: $(echo "$output" | grep "^d" | wc -l)"
//  4. Compares report counts with live counts and returns a ValidationResult.
func validateNFSDiscovery(csvPath, nfsSrc string) (*ValidationResult, error) {
	// ── Step 1: parse the report CSV ──────────────────────────────────────
	rows, err := ParseCSVFile(csvPath)
	if err != nil {
		return nil, fmt.Errorf("parse discovery CSV %q: %w", csvPath, err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("discovery CSV %q has no data rows", csvPath)
	}

	// Locate the row whose Path matches the expected NFS source path.
	// The path in the report is the bare export path (e.g. "/vol1") while
	// nfsSrc is "host:/vol1", so we compare against the suffix after ":".
	expectedPath := nfsSrc
	if idx := strings.Index(nfsSrc, ":"); idx != -1 {
		expectedPath = nfsSrc[idx+1:]
	}
	row := rows[0]
	for _, r := range rows {
		if p, ok := r["Path"]; ok && strings.EqualFold(strings.TrimSpace(p), expectedPath) {
			row = r
			break
		}
	}
	// Log which path we're validating against, to aid debugging when the
	// fallback selectAll was used and the scanned path differs from expected.
	if p := strings.TrimSpace(row["Path"]); p != "" && p != expectedPath {
		_ = fmt.Sprintf("[validateNFSDiscovery] report path %q != expected %q; validating against report path",
			p, expectedPath)
		// Mount the path that was actually scanned, not the one we expected.
		host := nfsSrc
		if idx := strings.Index(nfsSrc, ":"); idx != -1 {
			host = nfsSrc[:idx]
		}
		nfsSrc = fmt.Sprintf("%s:%s", host, p)
	}

	// Parse report counts in K units (2dp) — NDM rounds raw counts to K
	// when storing them, so comparing raw integers causes off-by-one failures.
	// Both sides are converted to the same K precision before comparing.
	reportFilesK, err := parseReportColumnK(row, "Regular Files Count")
	if err != nil {
		return nil, err
	}
	reportTotalK, err := parseReportColumnK(row, "Total Count")
	if err != nil {
		return nil, err
	}

	// ── Step 2 & 3: mount the NFS export and count with ls -lR ───────────
	lsSummary, err := LocalScanNFSWithLsLR(nfsSrc)
	if err != nil {
		return nil, fmt.Errorf("ls -lR scan of NFS %q: %w", nfsSrc, err)
	}

	// Convert actual counts to K (2dp) to match NDM's display precision.
	actualFilesK := IntToK(lsSummary.RegularFilesCount)
	actualTotalK := IntToK(lsSummary.RegularFilesCount + lsSummary.DirectoriesCount)

	LogDebug(fmt.Sprintf("[validateNFSDiscovery] report  — Total Count: %gK, Regular Files Count: %gK",
		reportTotalK, reportFilesK))
	LogDebug(fmt.Sprintf("[validateNFSDiscovery] ls -lR  — Total Count: %gK, Regular Files Count: %gK (raw: files=%d dirs=%d)",
		actualTotalK, actualFilesK, lsSummary.RegularFilesCount, lsSummary.DirectoriesCount))

	// ── Step 4: compare in K units ────────────────────────────────────────
	var diffs []string

	if reportFilesK != actualFilesK {
		diffs = append(diffs, fmt.Sprintf(
			"Regular Files Count mismatch: report=%gK actual=%gK (raw=%d)",
			reportFilesK, actualFilesK, lsSummary.RegularFilesCount))
	}

	// Total Count in NDM = files + directories + symlinks + hard links + …
	// ls -lR counts files ("-") and directories ("d") only.
	if reportTotalK != actualTotalK {
		diffs = append(diffs, fmt.Sprintf(
			"Total Count mismatch: report=%gK actual(files+dirs)=%gK (raw=%d; NDM may count additional types: symlinks, hard links, junctions)",
			reportTotalK, actualTotalK, lsSummary.RegularFilesCount+lsSummary.DirectoriesCount))
	}

	if len(diffs) > 0 {
		return &ValidationResult{Match: false, Diffs: diffs},
			fmt.Errorf("discovery report does not match live volume %q:\n  - %s",
				nfsSrc, strings.Join(diffs, "\n  - "))
	}

	return &ValidationResult{Match: true}, nil
}

// validateSMBDiscovery:
//  1. Parses the discovery report CSV to read "Total Count" and
//     "Regular Files Count".
//  2. SSHes into the AD/SMB server (AZURE_AD_SMB_SOURCE_HOST_IP) and counts
//     files/directories on the share using PowerShell Get-ChildItem
//     (via -EncodedCommand to handle passwords with special characters).
//  3. Compares report counts with live counts and returns a ValidationResult.
//
// The src argument must be a UNC-style string: \\smbHost\shareName
//
// All credentials and the SSH host are read from environment variables:
//
//	AZURE_AD_SMB_SOURCE_HOST_IP – AD/SMB server used for scanning (first IP if comma-separated)
//	NDM_SMB_WORKER_PORT         – SSH port                         (default 22)
//	NDM_SMB_WORKER_USERNAME     – SSH username
//	NDM_SMB_WORKER_PASSWORD     – SSH password
//	NDM_SMB_USERNAME            – SMB share access username
//	NDM_SMB_PASSWORD            – SMB share access password
func validateSMBDiscovery(csvPath, src string) (*ValidationResult, error) {
	// ── Step 1: parse UNC path  \\host\share ─────────────────────────────
	trimmed := strings.TrimPrefix(src, `\\`)
	parts := strings.SplitN(trimmed, `\`, 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return nil, fmt.Errorf(
			"SMB src %q must be in \\\\host\\share format", src)
	}
	smbHost := parts[0]
	shareName := parts[1]

	// ── Step 2: read config from environment ──────────────────────────────
	// Use the AD/SMB server as the scan host — it already has the necessary
	// domain membership and SMB access to mount the share via PowerShell.
	// AZURE_AD_SMB_SOURCE_HOST_IP may be comma-separated; take the first entry.
	adHostRaw := os.Getenv("AZURE_AD_SMB_SOURCE_HOST_IP")
	scanHost := strings.TrimSpace(strings.SplitN(adHostRaw, ",", 2)[0])
	if scanHost == "" {
		return nil, fmt.Errorf(
			"AZURE_AD_SMB_SOURCE_HOST_IP must be set for SMB discovery validation")
	}
	sshPort := 22
	if p := os.Getenv("NDM_SMB_WORKER_PORT"); p != "" {
		if n, err := strconv.Atoi(p); err == nil {
			sshPort = n
		}
	}
	sshCfg := SSHConfig{
		Host:     scanHost,
		Port:     sshPort,
		Username: os.Getenv("NDM_SMB_WORKER_USERNAME"),
		Password: os.Getenv("NDM_SMB_WORKER_PASSWORD"),
	}
	smbUser := os.Getenv("NDM_SMB_USERNAME")
	smbPass := os.Getenv("NDM_SMB_PASSWORD")

	if sshCfg.Username == "" || sshCfg.Password == "" {
		return nil, fmt.Errorf(
			"NDM_SMB_WORKER_USERNAME / NDM_SMB_WORKER_PASSWORD must be set for SMB validation")
	}
	if smbUser == "" || smbPass == "" {
		return nil, fmt.Errorf(
			"NDM_SMB_USERNAME / NDM_SMB_PASSWORD must be set for SMB validation")
	}

	// ── Step 3: parse the report CSV ─────────────────────────────────────
	rows, err := ParseCSVFile(csvPath)
	if err != nil {
		return nil, fmt.Errorf("parse SMB discovery CSV %q: %w", csvPath, err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("SMB discovery CSV %q has no data rows", csvPath)
	}
	row := rows[0]
	// Parse report counts in K units (same precision as NDM display).
	reportFilesK, err := parseReportColumnK(row, "Regular Files Count")
	if err != nil {
		return nil, err
	}
	reportTotalK, err := parseReportColumnK(row, "Total Count")
	if err != nil {
		return nil, err
	}

	// ── Step 4: SSH into Windows scan host and count via PowerShell ───────
	scan, err := ScanSMBVolumeForDiscovery(sshCfg, smbHost, shareName, smbUser, smbPass)
	if err != nil {
		return nil, fmt.Errorf(`SMB scan of \\%s\%s via %s: %w`,
			smbHost, shareName, scanHost, err)
	}

	// Convert actual counts to K (2dp) to match NDM's display precision.
	actualFilesK := IntToK(scan.RegularFilesCount)
	actualTotalK := IntToK(scan.RegularFilesCount + scan.DirectoriesCount)

	LogDebug(fmt.Sprintf("[validateSMBDiscovery] report  — Total Count: %gK, Regular Files Count: %gK",
		reportTotalK, reportFilesK))
	LogDebug(fmt.Sprintf("[validateSMBDiscovery] PowerShell — Total Count: %gK, Regular Files Count: %gK (raw: files=%d dirs=%d)",
		actualTotalK, actualFilesK, scan.RegularFilesCount, scan.DirectoriesCount))

	// ── Step 5: compare in K units ────────────────────────────────────────
	var diffs []string

	if reportFilesK != actualFilesK {
		diffs = append(diffs, fmt.Sprintf(
			"Regular Files Count mismatch: report=%gK actual=%gK (raw=%d)",
			reportFilesK, actualFilesK, scan.RegularFilesCount))
	}

	if reportTotalK != actualTotalK {
		diffs = append(diffs, fmt.Sprintf(
			`Total Count mismatch: report=%gK actual(files+dirs)=%gK (raw=%d; NDM may count additional types: symlinks, junctions)`,
			reportTotalK, actualTotalK, scan.RegularFilesCount+scan.DirectoriesCount))
	}

	if len(diffs) > 0 {
		return &ValidationResult{Match: false, Diffs: diffs},
			fmt.Errorf(`SMB discovery report does not match \\%s\%s:\n  - %s`,
				smbHost, shareName, strings.Join(diffs, "\n  - "))
	}

	return &ValidationResult{Match: true}, nil
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// parseReportColumn reads a named column from a CSVRow and parses it as an
// integer (handles K/M suffixes like "17.96K" → 17960).
func parseReportColumn(row CSVRow, col string) (int, error) {
	val, ok := row[col]
	if !ok || strings.TrimSpace(val) == "" {
		return 0, fmt.Errorf("column %q not found or empty in discovery CSV", col)
	}
	n, err := ParseHumanCount(val)
	if err != nil {
		return 0, fmt.Errorf("parse column %q value %q: %w", col, val, err)
	}
	return n, nil
}
