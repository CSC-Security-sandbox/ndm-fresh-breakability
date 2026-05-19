package utils

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"fmt"
	"io"
	"math"
	"os"
	"path"
	"strconv"
	"strings"
)

// CSVRow is a generic map of column→value for one row.
type CSVRow map[string]string

// ParseCSVFile reads a CSV file (or the first CSV inside a .zip) and returns
// rows as maps keyed by header. ZIP files are transparently unwrapped so
// callers do not need to distinguish between the two formats.
func ParseCSVFile(filePath string) ([]CSVRow, error) {
	var data []byte
	var err error
	if strings.HasSuffix(strings.ToLower(filePath), ".zip") {
		data, _, err = ExtractCSVFromZipFile(filePath)
		if err != nil {
			return nil, fmt.Errorf("extract CSV from ZIP %s: %w", filePath, err)
		}
	} else {
		data, err = os.ReadFile(filePath)
		if err != nil {
			return nil, fmt.Errorf("read CSV %s: %w", filePath, err)
		}
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

// ParseHumanCountToK parses an NDM count string and returns the value in
// K units, rounded to 2 decimal places — the same precision NDM uses when
// displaying counts.
//
// Examples:
//
//	"20.22K" → 20.22
//	"20.45K" → 20.45
//	"100"    → 0.10
//	"1.5M"   → 1500.00
func ParseHumanCountToK(s string) (float64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}
	upper := strings.ToUpper(s)

	var kValue float64
	switch {
	case strings.HasSuffix(upper, "K"):
		f, err := strconv.ParseFloat(strings.TrimSpace(s[:len(s)-1]), 64)
		if err != nil {
			return 0, fmt.Errorf("parse K count %q: %w", s, err)
		}
		kValue = f
	case strings.HasSuffix(upper, "M"):
		f, err := strconv.ParseFloat(strings.TrimSpace(s[:len(s)-1]), 64)
		if err != nil {
			return 0, fmt.Errorf("parse M count %q: %w", s, err)
		}
		kValue = f * 1000.0
	default:
		f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
		if err != nil {
			return 0, fmt.Errorf("parse count %q: %w", s, err)
		}
		kValue = f / 1000.0
	}

	return math.Round(kValue*100) / 100, nil
}

// IntToK converts an integer count to K units rounded to 2 decimal places,
// matching NDM's display precision.
//
//	20221 → 20.22
//	20448 → 20.45
//	100   → 0.10
func IntToK(n int) float64 {
	return math.Round(float64(n)/1000*100) / 100
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

