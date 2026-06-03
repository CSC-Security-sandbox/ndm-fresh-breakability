package utils

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// ─── Public types ─────────────────────────────────────────────────────────────

// NFSScriptDiscrepancy holds one line from the diff TSV produced by
// nfs_metadata_compare.sh — columns: path, field, src_value, dst_value.
type NFSScriptDiscrepancy struct {
	Path     string
	Field    string
	SrcValue string
	DstValue string
}

// NFSScriptCompareResult is returned by CompareNFSViaScript.
type NFSScriptCompareResult struct {
	Discrepancies []NFSScriptDiscrepancy
	HasDiffs      bool
}

func (r *NFSScriptCompareResult) Summary() string {
	if !r.HasDiffs {
		return "OK – no discrepancies found"
	}
	return fmt.Sprintf("%d discrepancy(ies) found", len(r.Discrepancies))
}

// ─── Main entry point ─────────────────────────────────────────────────────────

// CompareNFSViaScript runs nfs_metadata_compare.sh locally on the current
// machine (the CI runner) with parallel workers and returns parsed discrepancies.
//
// No SSH required — the script is in the repo at scripts/nfs_metadata_compare.sh
// and the runner has direct NFS access.
//
// srcExport / dstExport: NFS export paths, e.g. "172.30.202.22:/vol".
func CompareNFSViaScript(srcExport, dstExport string, workers int, skipChecksum bool) (*NFSScriptCompareResult, error) {
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

	log.Printf("[CompareNFSViaScript] running: sudo bash %s", strings.Join(args, " "))

	cmd := exec.Command("sudo", append([]string{"bash"}, args...)...)
	cmd.Stderr = os.Stderr
	output, err := cmd.Output()

	// The script exits 1 when discrepancies are found — that's not a fatal error.
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			log.Printf("[CompareNFSViaScript] script exited 1 (discrepancies found)")
		} else {
			// Clean up temp files.
			os.Remove(srcOut)
			os.Remove(dstOut)
			os.Remove(diffOut)
			return nil, fmt.Errorf("nfs_metadata_compare.sh failed: %w\noutput: %s", err, string(output))
		}
	}

	// Read the diff file if it exists.
	var diffContent string
	if data, readErr := os.ReadFile(diffOut); readErr == nil {
		diffContent = string(data)
	}

	// Clean up temp files.
	os.Remove(srcOut)
	os.Remove(dstOut)
	os.Remove(diffOut)

	return parseNFSScriptOutput(diffContent), nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// parseNFSScriptOutput parses the diff TSV produced by nfs_metadata_compare.sh.
// Header: path, field, source_value, destination_value, ...
func parseNFSScriptOutput(output string) *NFSScriptCompareResult {
	result := &NFSScriptCompareResult{}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "path\t") {
			continue
		}
		cols := strings.SplitN(line, "\t", 5)
		if len(cols) < 4 {
			continue
		}
		result.Discrepancies = append(result.Discrepancies, NFSScriptDiscrepancy{
			Path:     cols[0],
			Field:    cols[1],
			SrcValue: cols[2],
			DstValue: cols[3],
		})
	}
	result.HasDiffs = len(result.Discrepancies) > 0
	return result
}

// findNFSCompareScript locates nfs_metadata_compare.sh relative to this
// source file, then falls back to common relative paths.
func findNFSCompareScript() (string, error) {
	_, thisFile, _, ok := runtime.Caller(0)
	if ok {
		candidate := filepath.Join(filepath.Dir(thisFile), "..", "scripts", "nfs_metadata_compare.sh")
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	for _, p := range []string{
		"scripts/nfs_metadata_compare.sh",
		"../scripts/nfs_metadata_compare.sh",
		"ndm-ui-tests/scripts/nfs_metadata_compare.sh",
	} {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("nfs_metadata_compare.sh not found — expected at scripts/nfs_metadata_compare.sh")
}
