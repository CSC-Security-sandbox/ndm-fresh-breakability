package utils

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// --- Types & Internal Config ----------------------------------------------

// Format is the extension/type of a report.
type Format string

// JobType is one of three job‐types.
type JobType string

// jobFormats tells us, internally, which formats to load per JobType.
var jobFormats = map[JobType][]Format{
	JobTypeDiscovery: {FormatPDF, FormatCSV},
	JobTypeMigration: {FormatCSV},
	JobTypeCutover:   {FormatCSV},
}

// ValidationRules holds the paths to your JSON specs.

// --- Public Entry Point ---------------------------------------------------

// ValidateReport will validate reports for the given jobRunID and jobType:
// 1) Fetch each report format via HTTP GET from reportBaseURL.
// 2) validated on the user supplied json on each format.
// Returns a map[Format][]error of any non‐fatal validation issues
// or a fatal error if an HTTP or parsing error occurs.
func ValidateReport(
	jobRunID string,
	jobType JobType,
	spec string,
) (map[Format][]error, error) {
	formats, ok := jobFormats[jobType]
	if !ok {
		return nil, fmt.Errorf("no formats configured for jobType %q", jobType)
	}

	results := make(map[Format][]error, len(formats))
	for _, fmtType := range formats {
		// 1) fetch
		data, err := fetchReport(jobRunID, fmtType, string(jobType))
		if err != nil {
			return nil, fmt.Errorf("failed fetching %s/%s: %w", jobRunID, fmtType, err)
		}

		var (
			issues []error
			ferr   error
		)

		switch fmtType {

		case FormatPDF:
			// dump PDF bytes to temp file
			tmpPDF, err := os.CreateTemp("", "report-*.pdf")
			if err != nil {
				return nil, fmt.Errorf("create temp PDF: %w", err)
			}
			defer func() {
				tmpPDF.Close()
				os.Remove(tmpPDF.Name())
			}()
			if _, err := tmpPDF.Write(data); err != nil {
				return nil, fmt.Errorf("write temp PDF: %w", err)
			}

			// call your existing PDF‐vs‐JSON validator
			ferr = validatePDFAgainstJSON(tmpPDF.Name(), spec)

		case FormatCSV:
			// 1) Extract CSV bytes from the ZIP response
			csvBytes, _, err := extractCSVFromZip(data)
			if err != nil {
				return nil, fmt.Errorf("extract CSV from ZIP: %w", err)
			}

			// 2) Write CSV bytes to a temp file
			tmpCSV, err := os.CreateTemp("", "report-*.csv")
			if err != nil {
				return nil, fmt.Errorf("create temp CSV: %w", err)
			}
			defer func() {
				tmpCSV.Close()
				os.Remove(tmpCSV.Name())
			}()
			if _, err := tmpCSV.Write(csvBytes); err != nil {
				return nil, fmt.Errorf("write temp CSV: %w", err)
			}

			// 3) Validate
			ferr = validateCSVAgainstJSON(tmpCSV.Name(), spec)

		default:
			ferr = fmt.Errorf("unsupported format %s", fmtType)
		}

		if ferr != nil {
			// fatal: stop everything
			return nil, fmt.Errorf("validation error for %s/%s: %w", jobRunID, fmtType, ferr)
		}

		// no non‐fatal notes in this model
		results[fmtType] = issues
	}

	return results, nil
}

// --- HTTP Fetcher ----------------------------------------------------------

func fetchReport(
	jobRunID string,
	fmtType Format,
	reportType string,
) ([]byte, error) {
	// 1) pick endpoint and payload
	var (
		url     string
		payload interface{}
	)
	switch fmtType {
	case FormatCSV:
		url = ADMIN_SERVICE_URL + "/api/v1/report/inventory/download"
		var jobRun interface{}
		var reportTypeVal interface{}

		if reportType == string(JobTypeDiscovery) {
			jobRun = []string{jobRunID}
			reportTypeVal = reportType
		} else {
			jobRun = []string{jobRunID}
			reportTypeVal = "COC"
		}

		payload = map[string]interface{}{
			"jobRunId":    jobRun,
			"report-type": reportTypeVal,
		}

	case FormatPDF:
		url = ADMIN_SERVICE_URL + "/api/v1/report/pdf/generate"
		payload = map[string]interface{}{
			"jobRunId":    jobRunID,
			"report-type": reportType,
		}

	default:
		return nil, fmt.Errorf("unsupported format %q", fmtType)
	}

	// 2) marshal JSON body
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal request JSON: %w", err)
	}

	// 3) get token from env and prepare headers
	headers := GetHeaders(AuthToken, ContentTypeJSON)

	// 4) send POST
	resp, err := SendAPIRequest(http.MethodPost, url, bodyBytes, headers)
	if err != nil {
		return nil, fmt.Errorf("POST %s: %w", url, err)
	}
	defer resp.Body.Close()

	// 5) read response
	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response body: %w", err)
	}

	// 6) expect 200 OK
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("unexpected HTTP %d: %s",
			resp.StatusCode, string(respBytes))
	}

	return respBytes, nil
}

// --- PDF & CSV Validator Helpers ------------------------------------------

// validateCSV reads the first row (header) of CSV and checks required columns.
func validateCSVAgainstJSON(csvPath, jsonPath string) error {
	// 1) Load and parse JSON
	raw, err := os.ReadFile(jsonPath)
	if err != nil {
		return fmt.Errorf("read JSON %q: %w", jsonPath, err)
	}

	var expectedRows []map[string]interface{}

	// Try to unmarshal as an array of objects first
	if err := json.Unmarshal(raw, &expectedRows); err != nil {
		// If it fails, try to unmarshal as a single object
		var single map[string]interface{}
		if err2 := json.Unmarshal(raw, &single); err2 != nil {
			return fmt.Errorf("parse JSON %q: %w", jsonPath, err)
		}
		
		expectedRows = []map[string]interface{}{single}
	}

	// 2) Open CSV and read header
	f, err := os.Open(csvPath)
	if err != nil {
		return fmt.Errorf("open CSV %q: %w", csvPath, err)
	}
	defer f.Close()

	reader := csv.NewReader(f)
	header, err := reader.Read()
	if err != nil {
		return fmt.Errorf("read CSV header: %w", err)
	}

	// 3) Read all CSV rows into memory
	var csvRows [][]string
	for {
		record, err := reader.Read()
		if err != nil {
			break
		}
		csvRows = append(csvRows, record)
	}

	// 4) Check row count matches
	if len(expectedRows) != len(csvRows) {
		return fmt.Errorf("validation failed: expected %d rows, but CSV has %d rows", len(expectedRows), len(csvRows))
	}

	// 5) For each expected row, check if it exists in CSV (each CSV row can only match once)
	used := make([]bool, len(csvRows))
	for _, expected := range expectedRows {
		found := false
		for i, record := range csvRows {
			if used[i] {
				continue // already matched
			}
			match := true
			for key, val := range expected {
				idx := -1
				for j, h := range header {
					if strings.TrimSpace(h) == key {
						idx = j
						break
					}
				}
				if idx < 0 {
					match = false
					break
				}
				cell := strings.TrimSpace(record[idx])
				switch v := val.(type) {
				case float64:
					expectedInt := int(v)
					cleaned := strings.ReplaceAll(cell, ",", "")
					got, err := strconv.Atoi(cleaned)
					if err != nil || got != expectedInt {
						match = false
					}
				default:
					want := fmt.Sprint(v)
					if cell != want {
						match = false
					}
				}
				if !match {
					break
				}
			}
			if match {
				used[i] = true
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("validation failed: expected row %+v not found in CSV", expected)
		}
	}
	return nil
}

// validatePDFAgainstJSON extracts text from the PDF and validates it against the JSON spec.
func validatePDFAgainstJSON(pdfPath, jsonPath string) error {
	// 1) extract PDF text
	txt, err := extractTextFromPDF(pdfPath)
	if err != nil {
		return fmt.Errorf("extract PDF text: %w", err)
	}
	raw, err := os.ReadFile(jsonPath)
	if err != nil {
		return fmt.Errorf("read JSON: %w", err)
	}
	var flat map[string]interface{}

	if err := json.Unmarshal(raw, &flat); err != nil {
		return fmt.Errorf("parse JSON: %w", err)
	}

	// 3) iterate each key/value
	for key, val := range flat {
		// 3a) key must appear
		if !strings.Contains(txt, key) {
			return fmt.Errorf("validation failed: missing key %q", key)
		}

		switch v := val.(type) {
		case float64:
			// numeric comparison
			// build regex: key followed by optional spaces/colon, then capture digits+commas
			pattern := regexp.QuoteMeta(key) + `\s*[:=]?\s*([\d,]+)`
			re := regexp.MustCompile(pattern)
			m := re.FindStringSubmatch(txt)
			if len(m) < 2 {
				return fmt.Errorf("validation failed: cannot find numeric after %q", key)
			}
			foundRaw := m[1]
			// strip commas
			foundRaw = strings.ReplaceAll(foundRaw, ",", "")
			foundInt, err := strconv.Atoi(foundRaw)
			if err != nil {
				return fmt.Errorf("validation failed: cannot parse %q as int", m[1])
			}
			expected := int(v)
			if foundInt != expected {
				return fmt.Errorf("validation failed: for %q expected %d but found %d",
					key, expected, foundInt)
			}

		case string:
			// simple substring match
			if !strings.Contains(txt, v) {
				return fmt.Errorf("validation failed: missing value %q for key %q", v, key)
			}

		default:
			// fallback to sprint
			s := fmt.Sprint(v)
			if s != "" && !strings.Contains(txt, s) {
				return fmt.Errorf("validation failed: missing value %q for key %q", s, key)
			}
		}
	}
	// all keys & values matched
	return nil
}

// extractTextFromPDF uses the `pdftotext` command to extract text from a PDF file.
func extractTextFromPDF(pdfPath string) (string, error) {
	abs, err := filepath.Abs(pdfPath)
	if err != nil {
		abs = pdfPath
	}
	cmd := exec.Command("pdftotext", "-layout", "-nopgbrk", abs, "-")
	var buf bytes.Buffer
	cmd.Stdout = &buf
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// extractCSVFromZip takes ZIP bytes and returns the first CSV file's bytes.
func extractCSVFromZip(zipData []byte) ([]byte, string, error) {
	zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return nil, "", fmt.Errorf("open zip: %w", err)
	}
	for _, f := range zr.File {
		if strings.HasSuffix(strings.ToLower(f.Name), ".csv") {
			rc, err := f.Open()
			if err != nil {
				return nil, "", fmt.Errorf("open csv in zip: %w", err)
			}
			defer rc.Close()
			csvBytes, err := io.ReadAll(rc)
			if err != nil {
				return nil, "", fmt.Errorf("read csv in zip: %w", err)
			}
			return csvBytes, f.Name, nil
		}
	}
	return nil, "", fmt.Errorf("no CSV file found in zip")
}
