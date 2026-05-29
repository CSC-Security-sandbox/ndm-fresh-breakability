package utils

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"

	"ndm-ui-tests/config"
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
	// mounts source and destination volumes, collects per-file metadata and
	// compares each field against the corresponding column in the CoC report.
	// Supported for both NFS (UID/GID/permissions/mtime/atime/checksum) and
	// SMB (owner/ACL/size/mtime).
	ReportTypeMigration ReportType = "MIGRATION"

	// ReportTypeCutover validates the Chain-of-Custody cutover report CSV:
	// same field-by-field comparison as MIGRATION but applied to the final
	// incremental sync CSV that NDM generates at cutover time.
	// Supported for both NFS and SMB.
	ReportTypeCutover ReportType = "CUTOVER"
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

// ValidateReport validates an NDM report CSV against live volumes.
//
// Parameters:
//
//	reportType – DISCOVERY | MIGRATION | CUTOVER
//	protocol   – NFS or SMB
//	csvPath    – path to the NDM-generated report CSV (or ZIP containing it)
//	src        – source volume:  NFS "host:/export"  |  SMB "\\host\share"
//	dst        – destination volume (same format); ignored for DISCOVERY
func ValidateReport(reportType ReportType, protocol Protocol, csvPath, src, dst string) (*ValidationResult, error) {
	switch reportType {
	case ReportTypeDiscovery:
		return validateDiscoveryReport(protocol, csvPath, src)
	case ReportTypeMigration:
		return validateMigrationReport(protocol, csvPath, src, dst)
	case ReportTypeCutover:
		return validateCutoverReport(protocol, csvPath, src, dst)
	default:
		return nil, fmt.Errorf("unsupported report type %q (valid: DISCOVERY, MIGRATION, CUTOVER)", reportType)
	}
}

// ValidateNFSMigrationReport validates the NDM migration CoC report CSV by
// mounting the destination NFS export and comparing each file's metadata
// from the report against the live destination volume.
//
// Checked per file row:
//   - Size in Bytes (report vs live destination)
//   - Destination Checksum (report vs live — when present)
//   - Destination UID (report vs live)
//   - Destination GID (report vs live)
//   - Destination Unix Permissions (report vs live)
//
// Parameters:
//
//	csvPath    – path to the NDM-generated CoC CSV (or ZIP)
//	srcExport  – unused (kept for interface compatibility)
//	dstExport  – "host:/dst/volume" — mounted to compare against report
func ValidateNFSMigrationReport(csvPath, srcExport, dstExport string) (*ValidationResult, error) {
	const sampleSize = 100 // validate up to 100 files against live destination

	rows, err := ParseCSVFile(csvPath)
	if err != nil {
		return nil, fmt.Errorf("parse migration CSV %q: %w", csvPath, err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("migration CSV %q has no data rows", csvPath)
	}
	LogDebug(fmt.Sprintf("[ValidateNFSMigrationReport] CSV has %d rows, sampling %d against live dst", len(rows), sampleSize))

	// Mount and scan the destination volume.
	LogDebug(fmt.Sprintf("[ValidateNFSMigrationReport] scanning destination: %s", dstExport))
	dstStats, err := ScanNFSVolumeForMigrationValidation(dstExport)
	if err != nil {
		return nil, fmt.Errorf("destination NFS scan %q: %w", dstExport, err)
	}
	LogDebug(fmt.Sprintf("[ValidateNFSMigrationReport] destination: %d entries", len(dstStats)))

	var diffs []string
	var totalFiles, sampled int

	for _, row := range rows {
		dstPath := normalizeCoCDstPath(row)
		entryType := strings.ToLower(strings.TrimSpace(row["Type"]))
		isFile := entryType == "f" || entryType == "file"

		if !isFile {
			continue
		}
		totalFiles++
		if sampled >= sampleSize {
			continue // count total but skip validation beyond sample
		}

		dstStat, dstFound := dstStats[dstPath]
		if !dstFound {
			diffs = append(diffs, fmt.Sprintf("%s: not found on destination volume", dstPath))
			sampled++
			continue
		}

		// ── Size: report vs destination ───────────────────────────────────
		if sizeStr := strings.TrimSpace(row["Size in Bytes"]); sizeStr != "" {
			var reportSize int64
			if _, scanErr := fmt.Sscanf(sizeStr, "%d", &reportSize); scanErr == nil {
				if reportSize != dstStat.Size {
					diffs = append(diffs, fmt.Sprintf(
						"%s: size report=%d actual_dst=%d", dstPath, reportSize, dstStat.Size))
				}
			}
		}

		// ── Destination UID ───────────────────────────────────────────────
		if reportUID := strings.TrimSpace(row["Destination UID"]); reportUID != "" {
			if reportUID != dstStat.UID {
				diffs = append(diffs, fmt.Sprintf(
					"%s: UID report=%s actual=%s", dstPath, reportUID, dstStat.UID))
			}
		}

		// ── Destination GID ───────────────────────────────────────────────
		if reportGID := strings.TrimSpace(row["Destination GID"]); reportGID != "" {
			if reportGID != dstStat.GID {
				diffs = append(diffs, fmt.Sprintf(
					"%s: GID report=%s actual=%s", dstPath, reportGID, dstStat.GID))
			}
		}

		// ── Destination Unix Permissions ──────────────────────────────────
		if reportPerms := strings.TrimSpace(row["Destination Unix Permissions"]); reportPerms != "" {
			if reportPerms != dstStat.Permissions {
				diffs = append(diffs, fmt.Sprintf(
					"%s: permissions report=%s actual=%s", dstPath, reportPerms, dstStat.Permissions))
			}
		}

		// ── Destination Checksum ─────────────────────────────────────────
		srcCS := strings.TrimSpace(row["Source Checksum"])
		dstCS := strings.TrimSpace(row["Destination Checksum"])
		if srcCS != "" && dstCS != "" && !strings.EqualFold(srcCS, dstCS) {
			diffs = append(diffs, fmt.Sprintf(
				"%s: checksum mismatch src=%s dst=%s", dstPath, srcCS[:min8(len(srcCS))], dstCS[:min8(len(dstCS))]))
		}

		sampled++
	}

	// ── File count: CSV file rows vs destination file count ──────────────
	dstFileCount := 0
	for _, s := range dstStats {
		if s.Type == "f" {
			dstFileCount++
		}
	}
	if totalFiles != dstFileCount {
		diffs = append(diffs, fmt.Sprintf(
			"file count mismatch: CSV has %d file rows, destination has %d files", totalFiles, dstFileCount))
	}

	LogDebug(fmt.Sprintf("[ValidateNFSMigrationReport] totalFiles=%d dstFiles=%d sampled=%d diffs=%d",
		totalFiles, dstFileCount, sampled, len(diffs)))

	if len(diffs) > 0 {
		return &ValidationResult{Match: false, Diffs: diffs},
			fmt.Errorf("CoC report validation failed (%d issue(s) in %d files)", len(diffs), totalFiles)
	}
	return &ValidationResult{Match: true}, nil
}

// ─── Migration / Cutover dispatchers ─────────────────────────────────────────

// validateMigrationReport dispatches MIGRATION validation to the NFS or SMB
// implementation based on protocol.
func validateMigrationReport(protocol Protocol, csvPath, src, dst string) (*ValidationResult, error) {
	switch protocol {
	case ProtocolNFS:
		return ValidateNFSMigrationReport(csvPath, src, dst)
	case ProtocolSMB:
		return ValidateSMBMigrationReport(csvPath, src, dst)
	default:
		return nil, fmt.Errorf("unsupported protocol %q for MIGRATION (valid: NFS, SMB)", protocol)
	}
}

// validateCutoverReport dispatches CUTOVER validation to the NFS or SMB
// implementation based on protocol.  The cutover CoC CSV has the same column
// structure as the migration CoC CSV — only the phase that generated it differs.
func validateCutoverReport(protocol Protocol, csvPath, src, dst string) (*ValidationResult, error) {
	switch protocol {
	case ProtocolNFS:
		return ValidateNFSCutoverReport(csvPath, src, dst)
	case ProtocolSMB:
		return ValidateSMBCutoverReport(csvPath, src, dst)
	default:
		return nil, fmt.Errorf("unsupported protocol %q for CUTOVER (valid: NFS, SMB)", protocol)
	}
}

// ─── SMB Migration report validator ──────────────────────────────────────────

// ValidateSMBMigrationReport validates an NDM SMB Chain-of-Custody migration
// report CSV by mounting the destination share via the Windows worker and
// comparing each file's metadata from the report against the live destination.
//
// Checked per file row:
//   - Size in Bytes (report vs live destination)
//   - Destination Checksum (source checksum == destination checksum in report)
//   - Target Owner SID (report vs live destination owner)
//   - Target Group SID (report column vs live — if present in CSV)
//   - Target ACE Details (report column vs live ACL — if present in CSV)
//
// Parameters:
//
//	csvPath   – path to the NDM-generated SMB CoC CSV (or ZIP)
//	srcShare  – unused (kept for interface compatibility)
//	dstShare  – UNC path of destination share: \\host\shareName — mounted to compare
func ValidateSMBMigrationReport(csvPath, srcShare, dstShare string) (*ValidationResult, error) {
	const sampleSize = 100 // validate up to 100 files against live destination

	// ── Step 1: parse CoC CSV ─────────────────────────────────────────────
	rows, err := ParseCSVFile(csvPath)
	if err != nil {
		return nil, fmt.Errorf("parse SMB migration CSV %q: %w", csvPath, err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("SMB migration CSV %q has no data rows", csvPath)
	}
	LogDebug(fmt.Sprintf("[ValidateSMBMigrationReport] CSV has %d rows, sampling %d against live dst", len(rows), sampleSize))

	// ── Step 2: scan destination share via Windows worker ─────────────────
	workerCfg := SSHConfig{
		Host:     config.SMBWorkerHost,
		Port:     config.SMBWorkerPort,
		Username: config.SMBWorkerUsername,
		Password: config.SMBWorkerPassword,
	}
	if workerCfg.Host == "" {
		return nil, fmt.Errorf("SMB worker host is not configured (NDM_SMB_WORKER_HOST)")
	}

	LogDebug(fmt.Sprintf("[ValidateSMBMigrationReport] scanning destination share: %s", dstShare))
	dstEntries, err := scanSMBShare(workerCfg, dstShare, "Y:")
	if err != nil {
		return nil, fmt.Errorf("destination SMB scan %q: %w", dstShare, err)
	}
	dstMap := make(map[string]SMBMetadataEntry, len(dstEntries))
	for _, e := range dstEntries {
		dstMap[normalizeSMBPath(e.Path)] = e
	}
	LogDebug(fmt.Sprintf("[ValidateSMBMigrationReport] destination: %d entries", len(dstMap)))

	// ── Step 3: compare sample of CoC report against live destination ─────
	var diffs []string
	var totalFiles, sampled int

	for _, row := range rows {
		dstPath := normalizeSMBCoCPath(row["Destination Path"])
		entryType := strings.ToLower(strings.TrimSpace(row["Type"]))
		isFile := entryType == "f" || entryType == "file"

		if !isFile {
			continue
		}
		totalFiles++
		if sampled >= sampleSize {
			continue
		}

		dstEntry, dstFound := dstMap[dstPath]
		if !dstFound {
			diffs = append(diffs, fmt.Sprintf("%s: not found on destination share", dstPath))
			sampled++
			continue
		}

		// ── Size in Bytes: report vs destination ──────────────────────────
		if sizeStr := strings.TrimSpace(row["Size in Bytes"]); sizeStr != "" {
			var reportSize int64
			if _, scanErr := fmt.Sscanf(sizeStr, "%d", &reportSize); scanErr == nil {
				if reportSize != dstEntry.SizeBytes {
					diffs = append(diffs, fmt.Sprintf(
						"%s: size report=%d actual_dst=%d", dstPath, reportSize, dstEntry.SizeBytes))
				}
			}
		}

		// ── Destination Checksum: src checksum == dst checksum in report ──
		srcCS := strings.TrimSpace(row["Source Checksum"])
		dstCS := strings.TrimSpace(row["Destination Checksum"])
		if srcCS != "" && dstCS != "" && !strings.EqualFold(srcCS, dstCS) {
			diffs = append(diffs, fmt.Sprintf(
				"%s: checksum mismatch src=%s dst=%s", dstPath, srcCS[:min8(len(srcCS))], dstCS[:min8(len(dstCS))]))
		}

		// ── Target Owner SID: report vs live destination owner ────────────
		if reportOwner := strings.TrimSpace(row["Target Owner SID"]); reportOwner != "" {
			if !strings.EqualFold(reportOwner, dstEntry.Owner) {
				diffs = append(diffs, fmt.Sprintf(
					"%s: owner report=%q actual=%q", dstPath, reportOwner, dstEntry.Owner))
			}
		}

		// ── Target Group SID ─────────────────────────────────────────────
		// Validated via ACE details below.

		// ── Target ACE Details: report vs live ACL entries ────────────────
		if reportACE := strings.TrimSpace(row["Target ACE Details"]); reportACE != "" {
			liveACL := normalizeACLString(dstEntry.ACLEntries)
			if liveACL != "" && !strings.EqualFold(reportACE, liveACL) {
				diffs = append(diffs, fmt.Sprintf(
					"%s: ACE mismatch report=%q actual=%q", dstPath,
					reportACE[:min8(len(reportACE)*2)], liveACL[:min8(len(liveACL)*2)]))
			}
		}

		sampled++
	}

	// ── File count: CSV file rows vs destination file count ──────────────
	dstFileCount := 0
	for _, e := range dstEntries {
		if e.Type == "File" {
			dstFileCount++
		}
	}
	if totalFiles != dstFileCount {
		diffs = append(diffs, fmt.Sprintf(
			"file count mismatch: CSV has %d file rows, destination has %d files", totalFiles, dstFileCount))
	}

	LogDebug(fmt.Sprintf("[ValidateSMBMigrationReport] totalFiles=%d dstFiles=%d sampled=%d diffs=%d",
		totalFiles, dstFileCount, sampled, len(diffs)))

	if len(diffs) > 0 {
		return &ValidationResult{Match: false, Diffs: diffs},
			fmt.Errorf("SMB CoC report validation failed (%d issue(s) in %d files)", len(diffs), totalFiles)
	}
	return &ValidationResult{Match: true}, nil
}

// ─── NFS Cutover report validator ────────────────────────────────────────────

// ValidateNFSCutoverReport validates an NDM NFS Chain-of-Custody cutover report
// CSV.  The cutover CoC CSV has the same column structure as the migration CoC
// CSV, so this delegates directly to ValidateNFSMigrationReport.
//
// Parameters:
//
//	csvPath    – path to the NDM-generated cutover CoC CSV (or ZIP)
//	srcExport  – "host:/src/volume"  (NFS source)
//	dstExport  – "host:/dst/volume"  (NFS destination)
func ValidateNFSCutoverReport(csvPath, srcExport, dstExport string) (*ValidationResult, error) {
	LogDebug(fmt.Sprintf("[ValidateNFSCutoverReport] delegating to NFS migration validator (src=%s dst=%s)",
		srcExport, dstExport))
	return ValidateNFSMigrationReport(csvPath, srcExport, dstExport)
}

// ─── SMB Cutover report validator ────────────────────────────────────────────

// ValidateSMBCutoverReport validates an NDM SMB Chain-of-Custody cutover report
// CSV.  The cutover CoC CSV has the same column structure as the migration CoC
// CSV, so this delegates directly to ValidateSMBMigrationReport.
//
// Parameters:
//
//	csvPath   – path to the NDM-generated cutover CoC CSV (or ZIP)
//	srcShare  – UNC path of source share:      \\host\shareName
//	dstShare  – UNC path of destination share: \\host\shareName
func ValidateSMBCutoverReport(csvPath, srcShare, dstShare string) (*ValidationResult, error) {
	LogDebug(fmt.Sprintf("[ValidateSMBCutoverReport] delegating to SMB migration validator (src=%s dst=%s)",
		srcShare, dstShare))
	return ValidateSMBMigrationReport(csvPath, srcShare, dstShare)
}

// ─── SMB CoC helpers ──────────────────────────────────────────────────────────

// normalizeSMBCoCPath normalises a path from an SMB CoC CSV column so it can
// be matched against a PowerShell Get-ChildItem scan result.
// NDM stores SMB paths as "shareName\relative\path" or "\relative\path";
// we strip the share-name prefix and normalise separators.
func normalizeSMBCoCPath(p string) string {
	p = strings.TrimSpace(p)
	p = strings.ReplaceAll(p, `\`, "/")
	// Strip a leading share-name segment (everything before the first "/" after
	// an optional leading slash).
	p = strings.TrimPrefix(p, "/")
	if idx := strings.Index(p, "/"); idx != -1 {
		candidate := p[idx+1:]
		if candidate != "" {
			p = candidate
		}
	}
	return p
}

// normalizeSMBPath lowercases and trims a path from a PowerShell scan entry for
// consistent map lookups.
func normalizeSMBPath(p string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(p), "/"))
}

// compareSMBOwner compares a report CSV owner column against the live owner
// from a Windows Get-Acl call (case-insensitive).
func compareSMBOwner(diffs *[]string, filePath, colLabel string, row CSVRow, liveOwner, side string) {
	reportVal := strings.TrimSpace(row[colLabel])
	if reportVal == "" {
		return
	}
	if !strings.EqualFold(reportVal, liveOwner) {
		*diffs = append(*diffs, fmt.Sprintf(
			"%s: %s report=%q actual_%s=%q", filePath, colLabel, reportVal, side, liveOwner))
	}
}

// compareSMBTimestamp compares a report CSV epoch-seconds column against a live
// MtimeEpoch from a PowerShell scan (±1 s tolerance).
func compareSMBTimestamp(diffs *[]string, filePath, colLabel string, row CSVRow, liveEpoch int64) {
	reportStr := strings.TrimSpace(row[colLabel])
	if reportStr == "" {
		return
	}
	reportSec, err := strconv.ParseFloat(reportStr, 64)
	if err != nil {
		return
	}
	liveSec := float64(liveEpoch)
	if reportSec < 0 || liveSec < 0 {
		return // sentinel / unset value
	}
	if diff := reportSec - liveSec; diff > 1.0 || diff < -1.0 {
		*diffs = append(*diffs, fmt.Sprintf(
			"%s: %s report=%.0f actual=%.0f (delta=%.0f > 1s)",
			filePath, colLabel, reportSec, liveSec, diff))
	}
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
	// Strip the first path segment (volume/export name).
	// CSV paths are like "playwright-source-1/CL0_SWBUILD/Dir0" but NFS scans
	// produce paths relative to the mount root: "CL0_SWBUILD/Dir0".
	if idx := strings.Index(p, "/"); idx != -1 {
		p = p[idx+1:]
	}
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
//     output=$(sudo ls -lR /mnt/nfs-src 2>/dev/null)
//     echo "Files:       $(echo "$output" | grep "^-" | wc -l)"
//     echo "Directories: $(echo "$output" | grep "^d" | wc -l)"
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

// ─── Static file checksum validation ─────────────────────────────────────────

// staticChecksumEntry represents one expected row from the JSON spec.
type staticChecksumEntry struct {
	SourcePath          string `json:"Source Path"`
	DestinationChecksum string `json:"Destination Checksum"`
	ChecksumMatchStatus string `json:"ChecksumMatchStatus"`
}

// ValidateCoCStaticChecksums loads a JSON spec file (same format as ndm-api-tests
// validators) and verifies that each specified file in the CoC CSV has the
// expected checksum value. This proves NDM computed checksums correctly for
// known files with pre-computed hashes.
//
// JSON spec format:
//
//	[
//	  {"Source Path": "/vol/Dir/file.txt", "Destination Checksum": "abc123..."},
//	  {"Source Path": "/vol/Dir/file2.txt", "ChecksumMatchStatus": "yes"}
//	]
//
// Each entry can specify:
//   - "Destination Checksum" — exact hash value expected in the CSV
//   - "ChecksumMatchStatus" — expected status value (usually "yes")
//   - Both — checks both
//
// Parameters:
//
//	csvPath  – path to the CoC CSV (or ZIP)
//	specPath – path to the JSON spec file with expected values
//	volumeReplacements – optional map to replace volume names in paths
func ValidateCoCStaticChecksums(csvPath, specPath string, volumeReplacements ...map[string]string) (*ValidationResult, error) {
	// Load JSON spec.
	specData, err := os.ReadFile(specPath)
	if err != nil {
		return nil, fmt.Errorf("read spec file %q: %w", specPath, err)
	}

	// Apply volume name replacements if provided.
	specContent := string(specData)
	if len(volumeReplacements) > 0 && volumeReplacements[0] != nil {
		for old, new := range volumeReplacements[0] {
			specContent = strings.ReplaceAll(specContent, old, new)
		}
	}

	var expectedEntries []staticChecksumEntry
	if err := json.Unmarshal([]byte(specContent), &expectedEntries); err != nil {
		return nil, fmt.Errorf("parse spec JSON %q: %w", specPath, err)
	}
	if len(expectedEntries) == 0 {
		return nil, fmt.Errorf("spec file %q has no entries", specPath)
	}

	// Parse CoC CSV.
	rows, err := ParseCSVFile(csvPath)
	if err != nil {
		return nil, fmt.Errorf("parse CSV %q: %w", csvPath, err)
	}

	// Build lookup: normalized source path → CSV row.
	csvByPath := make(map[string]CSVRow, len(rows))
	for _, row := range rows {
		srcPath := strings.TrimSpace(row["Source Path"])
		srcPath = strings.ReplaceAll(srcPath, `\`, "/")
		csvByPath[srcPath] = row
	}

	var diffs []string
	matched := 0

	for _, expected := range expectedEntries {
		path := strings.ReplaceAll(expected.SourcePath, `\`, "/")

		csvRow, found := csvByPath[path]
		if !found {
			diffs = append(diffs, fmt.Sprintf("%s: not found in CoC CSV", path))
			continue
		}
		matched++

		// Check Destination Checksum if specified.
		if expected.DestinationChecksum != "" {
			actual := strings.TrimSpace(csvRow["Destination Checksum"])
			if !strings.EqualFold(expected.DestinationChecksum, actual) {
				diffs = append(diffs, fmt.Sprintf(
					"%s: checksum expected=%s actual=%s",
					path, expected.DestinationChecksum[:min8(len(expected.DestinationChecksum))],
					actual[:min8(len(actual))]))
			}
		}

		// Check ChecksumMatchStatus if specified.
		if expected.ChecksumMatchStatus != "" {
			actual := strings.TrimSpace(csvRow["ChecksumMatchStatus"])
			if !strings.EqualFold(expected.ChecksumMatchStatus, actual) {
				diffs = append(diffs, fmt.Sprintf(
					"%s: ChecksumMatchStatus expected=%q actual=%q",
					path, expected.ChecksumMatchStatus, actual))
			}
		}
	}

	LogDebug(fmt.Sprintf("[ValidateCoCStaticChecksums] spec=%d matched=%d diffs=%d",
		len(expectedEntries), matched, len(diffs)))

	if len(diffs) > 0 {
		return &ValidationResult{Match: false, Diffs: diffs},
			fmt.Errorf("static checksum validation failed (%d issue(s) in %d expected entries)",
				len(diffs), len(expectedEntries))
	}
	return &ValidationResult{Match: true}, nil
}
