package utils

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// ─── Public types ─────────────────────────────────────────────────────────────

// NFSMetadataDiscrepancy describes a single field-level mismatch between exports.
type NFSMetadataDiscrepancy struct {
	Path     string
	Field    string
	SrcValue string
	DstValue string
}

// NFSMetadataResult is returned by CompareNFSMetadata.
type NFSMetadataResult struct {
	TotalSrc      int
	TotalDst      int
	SrcOnlyPaths  []string
	DstOnlyPaths  []string
	Discrepancies []NFSMetadataDiscrepancy
}

// HasMismatches returns true when any entry is missing or has a field difference.
func (r *NFSMetadataResult) HasMismatches() bool {
	return len(r.SrcOnlyPaths) > 0 || len(r.DstOnlyPaths) > 0 || len(r.Discrepancies) > 0
}

// Summary returns a human-readable one-liner.
func (r *NFSMetadataResult) Summary() string {
	if !r.HasMismatches() {
		return fmt.Sprintf("OK – %d entries match", r.TotalSrc)
	}
	return fmt.Sprintf(
		"%d discrepancies, %d src-only, %d dst-only (src=%d dst=%d entries)",
		len(r.Discrepancies), len(r.SrcOnlyPaths), len(r.DstOnlyPaths),
		r.TotalSrc, r.TotalDst,
	)
}

// NFSCompareOptions controls which fields are compared.
type NFSCompareOptions struct {
	SkipAtime       bool // do not compare atime
	SkipUID         bool // do not compare uid
	SkipGID         bool // do not compare gid
	SkipPermissions bool // do not compare permission bits
	SkipSize        bool // do not compare file size
	MtimeToleranceSec float64 // allowed mtime delta in seconds (default 1.0)
}

// ─── Main entry point ─────────────────────────────────────────────────────────

// CompareNFSMetadata mounts srcExport and dstExport read-only on the local
// machine (the CI runner) and compares per-entry metadata field-by-field.
//
// srcExport / dstExport must be NFS export paths, e.g. "172.30.202.20:/vol1".
// Both mounts are created in /mnt/… and cleaned up before returning.
func CompareNFSMetadata(srcExport, dstExport string, opts NFSCompareOptions) (*NFSMetadataResult, error) {
	if opts.MtimeToleranceSec == 0 {
		opts.MtimeToleranceSec = 1.0
	}

	LogDebug(fmt.Sprintf("CompareNFSMetadata: scanning src=%s", srcExport))
	srcMap, err := ScanNFSVolumeForMigrationValidation(srcExport)
	if err != nil {
		return nil, fmt.Errorf("scan source NFS %s: %w", srcExport, err)
	}
	LogDebug(fmt.Sprintf("CompareNFSMetadata: src has %d entries", len(srcMap)))

	LogDebug(fmt.Sprintf("CompareNFSMetadata: scanning dst=%s", dstExport))
	dstMap, err := ScanNFSVolumeForMigrationValidation(dstExport)
	if err != nil {
		return nil, fmt.Errorf("scan destination NFS %s: %w", dstExport, err)
	}
	LogDebug(fmt.Sprintf("CompareNFSMetadata: dst has %d entries", len(dstMap)))

	result := diffNFSEntries(srcMap, dstMap, opts)
	LogDebug(fmt.Sprintf("CompareNFSMetadata: %s", result.Summary()))
	return result, nil
}

// ─── Comparison engine ────────────────────────────────────────────────────────

func diffNFSEntries(src, dst map[string]NFSFileStat, opts NFSCompareOptions) *NFSMetadataResult {
	result := &NFSMetadataResult{
		TotalSrc: len(src),
		TotalDst: len(dst),
	}

	for path := range src {
		if _, ok := dst[path]; !ok {
			result.SrcOnlyPaths = append(result.SrcOnlyPaths, path)
		}
	}
	for path := range dst {
		if _, ok := src[path]; !ok {
			result.DstOnlyPaths = append(result.DstOnlyPaths, path)
		}
	}

	for path, s := range src {
		d, ok := dst[path]
		if !ok {
			continue
		}

		record := func(field, sv, dv string) {
			result.Discrepancies = append(result.Discrepancies, NFSMetadataDiscrepancy{
				Path: path, Field: field, SrcValue: sv, DstValue: dv,
			})
		}

		if s.Type != d.Type {
			record("type", s.Type, d.Type)
			continue
		}

		if !opts.SkipSize && s.Type == "f" && s.Size != d.Size {
			record("size_bytes", fmt.Sprintf("%d", s.Size), fmt.Sprintf("%d", d.Size))
		}
		if !opts.SkipUID && s.UID != d.UID {
			record("uid", s.UID, d.UID)
		}
		if !opts.SkipGID && s.GID != d.GID {
			record("gid", s.GID, d.GID)
		}
		if !opts.SkipPermissions && s.Permissions != d.Permissions {
			record("permissions", s.Permissions, d.Permissions)
		}

		if math.Abs(s.Mtime-d.Mtime) > opts.MtimeToleranceSec {
			record("mtime",
				fmt.Sprintf("%.3f", s.Mtime),
				fmt.Sprintf("%.3f", d.Mtime))
		}

		if !opts.SkipAtime && math.Abs(s.Atime-d.Atime) > opts.MtimeToleranceSec {
			record("atime",
				fmt.Sprintf("%.3f", s.Atime),
				fmt.Sprintf("%.3f", d.Atime))
		}
	}

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

// normalizeNFSPath strips leading slashes and volume-root segments from a path
// so it can be matched between CoC CSV entries and live scan results.
func normalizeNFSPath(p string) string {
	p = strings.TrimSpace(p)
	p = strings.TrimPrefix(p, "/")
	return p
}
