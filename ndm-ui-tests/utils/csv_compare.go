package utils

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"path"
	"strconv"
	"strings"
)

// CSVRow is a generic map of column→value for one row.
type CSVRow map[string]string

// ParseCSVFile reads a CSV file and returns rows as maps keyed by header.
func ParseCSVFile(filePath string) ([]CSVRow, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("read CSV %s: %w", filePath, err)
	}
	return ParseCSVBytes(data)
}

// ParseCSVBytes parses CSV content and returns rows as maps keyed by header.
func ParseCSVBytes(data []byte) ([]CSVRow, error) {
	r := csv.NewReader(bytes.NewReader(data))
	r.LazyQuotes = true
	r.TrimLeadingSpace = true

	header, err := r.Read()
	if err != nil {
		return nil, fmt.Errorf("read CSV header: %w", err)
	}
	for i := range header {
		header[i] = strings.TrimSpace(header[i])
	}

	var rows []CSVRow
	for {
		record, err := r.Read()
		if err != nil {
			break
		}
		row := make(CSVRow)
		for i, h := range header {
			if i < len(record) {
				row[h] = strings.TrimSpace(record[i])
			}
		}
		rows = append(rows, row)
	}
	return rows, nil
}

// ExtractCSVFromZipFile opens a ZIP file and returns the first CSV found.
func ExtractCSVFromZipFile(zipPath string) ([]byte, string, error) {
	data, err := os.ReadFile(zipPath)
	if err != nil {
		return nil, "", fmt.Errorf("read zip: %w", err)
	}
	return ExtractCSVFromZipBytes(data)
}

// ExtractCSVFromZipBytes extracts the first CSV file from ZIP bytes.
func ExtractCSVFromZipBytes(data []byte) ([]byte, string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, "", fmt.Errorf("open zip: %w", err)
	}
	for _, f := range zr.File {
		name := path.Base(f.Name)
		if !strings.HasSuffix(strings.ToLower(name), ".csv") {
			continue
		}
		if strings.HasPrefix(name, ".") || strings.Contains(f.Name, "__MACOSX") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, "", fmt.Errorf("open csv in zip: %w", err)
		}
		csvBytes, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return nil, "", fmt.Errorf("read csv in zip: %w", err)
		}
		return csvBytes, f.Name, nil
	}
	return nil, "", fmt.Errorf("no CSV file found in ZIP")
}

// ParseHumanCount converts human-readable counts like "20.45K" to an integer.
// Handles plain numbers and K/M suffixes.
func ParseHumanCount(s string) (int, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}

	multiplier := 1.0
	numStr := s
	upper := strings.ToUpper(s)

	if strings.HasSuffix(upper, "K") {
		multiplier = 1000
		numStr = s[:len(s)-1]
	} else if strings.HasSuffix(upper, "M") {
		multiplier = 1_000_000
		numStr = s[:len(s)-1]
	}

	f, err := strconv.ParseFloat(strings.TrimSpace(numStr), 64)
	if err != nil {
		return 0, fmt.Errorf("parse count %q: %w", s, err)
	}
	return int(f * multiplier), nil
}

// CompareDiscoveryReport compares the discovery summary from a real volume
// scan against the downloaded discovery report CSV.
// The CSV typically has columns "Total Count" and "Regular Files Count".
func CompareDiscoveryReport(reportCSVPath string, scan *DiscoverySummary) ([]string, error) {
	var csvBytes []byte
	var err error

	if strings.HasSuffix(reportCSVPath, ".zip") {
		csvBytes, _, err = ExtractCSVFromZipFile(reportCSVPath)
		if err != nil {
			return nil, err
		}
	} else {
		csvBytes, err = os.ReadFile(reportCSVPath)
		if err != nil {
			return nil, fmt.Errorf("read report CSV: %w", err)
		}
	}

	rows, err := ParseCSVBytes(csvBytes)
	if err != nil {
		return nil, err
	}

	if len(rows) == 0 {
		return nil, fmt.Errorf("report CSV has no data rows")
	}

	var diffs []string

	// Discovery reports are summary rows. Check each row's Total Count
	// and Regular Files Count against the scan.
	for i, row := range rows {
		if tc, ok := row["Total Count"]; ok {
			reported, err := ParseHumanCount(tc)
			if err != nil {
				return nil, fmt.Errorf("row %d Total Count: %w", i, err)
			}
			if reported != scan.TotalCount {
				diffs = append(diffs, fmt.Sprintf(
					"Total Count: report=%d, volume=%d", reported, scan.TotalCount))
			}
		}

		if rfc, ok := row["Regular Files Count"]; ok {
			reported, err := ParseHumanCount(rfc)
			if err != nil {
				return nil, fmt.Errorf("row %d Regular Files Count: %w", i, err)
			}
			if reported != scan.RegularFilesCount {
				diffs = append(diffs, fmt.Sprintf(
					"Regular Files Count: report=%d, volume=%d", reported, scan.RegularFilesCount))
			}
		}
	}

	return diffs, nil
}

// CompareMigrationReport compares per-file Source Path entries between
// the CoC report CSV and the volume scan rows.
// Returns a list of mismatches (empty = all match).
func CompareMigrationReport(reportCSVPath string, scanRows []VolumeScanRow) ([]string, error) {
	var csvBytes []byte
	var err error

	if strings.HasSuffix(reportCSVPath, ".zip") {
		csvBytes, _, err = ExtractCSVFromZipFile(reportCSVPath)
		if err != nil {
			return nil, err
		}
	} else {
		csvBytes, err = os.ReadFile(reportCSVPath)
		if err != nil {
			return nil, fmt.Errorf("read report CSV: %w", err)
		}
	}

	reportRows, err := ParseCSVBytes(csvBytes)
	if err != nil {
		return nil, err
	}

	// Build a set of source paths from the report.
	reportPaths := make(map[string]CSVRow, len(reportRows))
	for _, row := range reportRows {
		if sp, ok := row["Source Path"]; ok {
			normalized := strings.TrimSpace(sp)
			reportPaths[normalized] = row
		}
	}

	// Build a set of paths from the volume scan (files only for CoC).
	scanPaths := make(map[string]VolumeScanRow, len(scanRows))
	for _, row := range scanRows {
		if row.Type == "f" {
			scanPaths[row.Path] = row
		}
	}

	var diffs []string

	// Files in report but not on volume
	for rp := range reportPaths {
		found := false
		for sp := range scanPaths {
			if strings.HasSuffix(rp, sp) || strings.HasSuffix(sp, rp) || rp == sp {
				found = true
				break
			}
		}
		if !found {
			diffs = append(diffs, fmt.Sprintf("in report but not on volume: %s", rp))
		}
	}

	// Files on volume but not in report
	for sp := range scanPaths {
		found := false
		for rp := range reportPaths {
			if strings.HasSuffix(rp, sp) || strings.HasSuffix(sp, rp) || rp == sp {
				found = true
				break
			}
		}
		if !found {
			diffs = append(diffs, fmt.Sprintf("on volume but not in report: %s", sp))
		}
	}

	if len(diffs) == 0 {
		// Row count sanity check
		if len(reportPaths) != len(scanPaths) {
			diffs = append(diffs, fmt.Sprintf(
				"file count mismatch: report=%d, volume=%d", len(reportPaths), len(scanPaths)))
		}
	}

	return diffs, nil
}
