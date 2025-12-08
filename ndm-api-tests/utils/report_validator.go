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
// volumeReplacements: optional map to replace volume names in JSON spec (e.g., "vol_dnd_src_automation_1" -> "clone_master_nfs_vol_s_tc001_12345")
func ValidateReport(
	jobRunID string,
	jobType JobType,
	spec string,
	volumeReplacements ...map[string]string,
) (map[Format][]error, error) {
	
	var volReplace map[string]string
	if len(volumeReplacements) > 0 {
		volReplace = volumeReplacements[0]
	}

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
			defer cleanup(tmpPDF)
			if _, err := tmpPDF.Write(data); err != nil {
				return nil, fmt.Errorf("write temp PDF: %w", err)
			}
			// validate PDF against JSON spec
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
			defer cleanup(tmpCSV)
			if _, err := tmpCSV.Write(csvBytes); err != nil {
				return nil, fmt.Errorf("write temp CSV: %w", err)
			}

			// 3) validate CSV against JSON spec (with optional volume replacements)
			ferr = validateCSVAgainstJSON(tmpCSV.Name(), spec, volReplace)

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
		jobRun := []string{jobRunID}
		reportTypeVal := "COC"
		if reportType == string(JobTypeDiscovery) {
			reportTypeVal = reportType
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
	Wait(20)

	// 2) marshal JSON body
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal request JSON: %w", err)
	}

	// 3) get token from env and prepare headers
	headers := GetHeaders(AuthToken, ContentTypeJSON)

	const maxRetries = MaxPollRetries
	const retryDelay = DefaultPollInterval // adjust as needed

	for attempt := 1; attempt <= maxRetries; attempt++ {
		// 4) send POST
		LogDebug(fmt.Sprintf("Getting %s reports for %s ID %s, attempt %d", fmtType, reportType, jobRunID, attempt))
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

		// 6) expect 200 OK or 201 CREATED
		if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated {
			return respBytes, nil
		}

		// Retry on 500 Internal Server Error
		if resp.StatusCode == http.StatusInternalServerError {
			if attempt < maxRetries {
				Wait(retryDelay)
				continue
			}
			return nil, fmt.Errorf("received HTTP 500 after %d retries: %s", maxRetries, string(respBytes))
		}

		// Retry on 404 with specific message
		if resp.StatusCode == http.StatusNotFound {
			// Try to parse the response body as JSON to check the message

			if attempt < maxRetries {
				Wait(retryDelay)
				continue
			}
			return nil, fmt.Errorf("received HTTP 404 after %d retries: %s", maxRetries, string(respBytes))

		}

		// For other status codes, return error immediately
		return nil, fmt.Errorf("unexpected HTTP %d: %s", resp.StatusCode, string(respBytes))
	}

	return nil, fmt.Errorf("failed to fetch report after %d retries", maxRetries)
}

// --- PDF & CSV Validator Helpers ------------------------------------------

// validateCSV reads the first row (header) of CSV and checks required columns.
func validateCSVAgainstJSON(csvPath, jsonPath string, volumeReplacements map[string]string) error {
	LogDebug(fmt.Sprintf("[ValidateReport] Validating CSV against JSON spec: %s", jsonPath))
	// 1) Load and parse JSON
	raw, err := os.ReadFile(jsonPath)
	if err != nil {
		return fmt.Errorf("read JSON %q: %w", jsonPath, err)
	}

	// 2) Replace volume names in JSON content if replacements provided
	jsonContent := string(raw)
	if volumeReplacements != nil {
		for oldVol, newVol := range volumeReplacements {
			jsonContent = strings.ReplaceAll(jsonContent, oldVol, newVol)
			LogDebug(fmt.Sprintf("Replaced volume name in validator: '%s' -> '%s'", oldVol, newVol))
		}
	}

	var expectedRows []map[string]interface{}
	if err := json.Unmarshal([]byte(jsonContent), &expectedRows); err != nil {
		return fmt.Errorf("parse JSON %q: %w", jsonPath, err)
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
				want := strings.TrimSpace(fmt.Sprint(val))
				if cell != want {
					match = false
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
	LogDebug(fmt.Sprintf("[ValidateReport] Validating PDF against JSON spec: %s", jsonPath))
	// 1) Extract PDF text
	txt, err := extractTextFromPDF(pdfPath)
	if err != nil {
		return fmt.Errorf("extract PDF text: %w", err)
	}

	// 2) Read and parse JSON as a list of maps with string values
	raw, err := os.ReadFile(jsonPath)
	if err != nil {
		return fmt.Errorf("read JSON: %w", err)
	}
	var rows []map[string]string
	if err := json.Unmarshal(raw, &rows); err != nil {
		return fmt.Errorf("parse JSON: %w", err)
	}

	// 3) For each row, check all key-value pairs in PDF text
	for _, row := range rows {
		for key, val := range row {
			// Build regex: key, optional spaces, optional colon or equals, optional spaces, value
			pattern := regexp.QuoteMeta(key) + `\s*[:=]?\s*` + regexp.QuoteMeta(val)
			re := regexp.MustCompile(pattern)
			if !re.MatchString(txt) {
				// Extract what value is actually in the PDF for this key
				actualPattern := regexp.QuoteMeta(key) + `\s*[:=]?\s*(\S+)`
				actualRe := regexp.MustCompile(actualPattern)
				actualMatch := actualRe.FindStringSubmatch(txt)
				var actualValue string
				if len(actualMatch) > 1 {
					actualValue = actualMatch[1]
				} else {
					actualValue = "<not found>"
				}
				LogError(fmt.Sprintf("PDF Validation mismatch - Key: %q, Expected: %q, Actual: %q", key, val, actualValue))
				return fmt.Errorf("validation failed: missing key-value pair %q in format for key %q (actual value in PDF: %q)", val, key, actualValue)
			}
		}
	}
	return nil
}

// extractTextFromPDF uses the `pdftotext` command to extract text from a PDF file.
func extractTextFromPDF(pdfPath string) (string, error) {
	abs, err := filepath.Abs(pdfPath)
	if err != nil {
		abs = pdfPath
	}
	cmd := exec.Command("pdftotext", "-raw", "-nopgbrk", abs, "-")
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

// cleanup closes the file and removes it from disk.
func cleanup(f *os.File) {
	f.Close()
	os.Remove(f.Name())
}
