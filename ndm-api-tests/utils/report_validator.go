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
	"path"
	"path/filepath"
	"regexp"
	"sort"
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
			// Extract all CSV files from the ZIP. Reports may be packaged as a single folder
			// (e.g. <jobRunId>-coc-report/*.csv) rather than CSVs at the archive root.
			csvFiles, err := extractCSVFilesFromZip(data)
			if err != nil {
				return nil, fmt.Errorf("extract CSV from ZIP: %w", err)
			}

			specInfo, statErr := os.Stat(spec)
			if statErr != nil {
				return nil, fmt.Errorf("stat spec path %q: %w", spec, statErr)
			}

			if specInfo.IsDir() {
				// Folder-based validation:
				// for each CSV in ZIP, try matching <csv-file-base>.json in spec folder.
				validatedCount := 0
				for zipCSVPath, csvBytes := range csvFiles {
					baseCSV := path.Base(normalizeZipEntryPath(zipCSVPath))
					jsonName := strings.TrimSuffix(baseCSV, filepath.Ext(baseCSV)) + ".json"
					jsonSpecPath := filepath.Join(spec, jsonName)

					if _, err := os.Stat(jsonSpecPath); err != nil {
						if os.IsNotExist(err) {
							LogDebug(fmt.Sprintf("No JSON spec found for CSV %q at %q, skipping", zipCSVPath, jsonSpecPath))
							continue
						}
						return nil, fmt.Errorf("stat JSON spec %q: %w", jsonSpecPath, err)
					}

					tmpCSV, err := os.CreateTemp("", "report-*.csv")
					if err != nil {
						return nil, fmt.Errorf("create temp CSV: %w", err)
					}
					defer cleanup(tmpCSV)
					if _, err := tmpCSV.Write(csvBytes); err != nil {
						return nil, fmt.Errorf("write temp CSV: %w", err)
					}

					if err := validateCSVAgainstJSON(tmpCSV.Name(), jsonSpecPath, volReplace); err != nil {
						return nil, fmt.Errorf("validate CSV %q against %q: %w", zipCSVPath, jsonSpecPath, err)
					}
					validatedCount++
				}

				if validatedCount == 0 {
					return nil, fmt.Errorf("no matching JSON specs found in folder %q for any CSV in ZIP", spec)
				}
				ferr = nil
			} else {
				// Single JSON spec file:
				// pick the most relevant CSV from ZIP based on job type / filename.
				selectedCSVPath, selectedCSVBytes, err := pickCSVForValidation(csvFiles, jobType)
				if err != nil {
					return nil, fmt.Errorf("select CSV for validation: %w", err)
				}

				LogDebug(fmt.Sprintf("Selected CSV %q for validation against %q", selectedCSVPath, spec))

				tmpCSV, err := os.CreateTemp("", "report-*.csv")
				if err != nil {
					return nil, fmt.Errorf("create temp CSV: %w", err)
				}
				defer cleanup(tmpCSV)
				if _, err := tmpCSV.Write(selectedCSVBytes); err != nil {
					return nil, fmt.Errorf("write temp CSV: %w", err)
				}

				ferr = validateCSVAgainstJSON(tmpCSV.Name(), spec, volReplace)
			}

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
	switch fmtType {
	case FormatCSV:
		return fetchCSVReport(jobRunID, reportType)
	case FormatPDF:
		return fetchPDFReport(jobRunID, reportType)
	default:
		return nil, fmt.Errorf("unsupported format %q", fmtType)
	}
}

// fetchCSVReport dispatches to the correct download strategy based on job type.
// Both flows return ZIP bytes; CSVs may live inside a folder in the archive (not at the root).
//   - Discovery: POST /inventory/download — ZIP often contains e.g. .../discovery-report.csv
//   - Migration / Cutover: prepare-download → GET /download/:token — ZIP contains e.g.
//     <jobRunId>-coc-report/coc-report.csv (and list CSVs). Legacy POST without prepare 404s after zip.
func fetchCSVReport(jobRunID string, reportType string) ([]byte, error) {
	if reportType == string(JobTypeDiscovery) {
		return fetchDiscoveryCSV(jobRunID)
	}
	return fetchCocCSV(jobRunID)
}

// fetchDiscoveryCSV fetches a discovery report ZIP via POST /inventory/download.
// The archive may contain a folder with discovery-report.csv inside.
func fetchDiscoveryCSV(jobRunID string) ([]byte, error) {
	url := ADMIN_SERVICE_URL + INVENTORY_DOWNLOAD_ENDPOINT
	payload := map[string]interface{}{
		"jobRunId":    []string{jobRunID},
		"report-type": "DISCOVER", // matches ReportType.DISCOVERY enum value in the service
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal discovery download request: %w", err)
	}

	headers := GetHeaders(AuthToken, ContentTypeJSON)

	const maxRetries = MaxPollRetries
	const retryDelay = DefaultPollInterval

	Wait(20)

	for attempt := 1; attempt <= maxRetries; attempt++ {
		LogDebug(fmt.Sprintf("Downloading discovery CSV for ID %s, attempt %d", jobRunID, attempt))

		resp, err := SendAPIRequest(http.MethodPost, url, bodyBytes, headers)
		if err != nil {
			return nil, fmt.Errorf("POST %s: %w", url, err)
		}
		respBytes, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("read discovery download response: %w", readErr)
		}

		if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated {
			return respBytes, nil
		}
		if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusInternalServerError {
			if attempt < maxRetries {
				Wait(retryDelay)
				continue
			}
			return nil, fmt.Errorf("discovery download HTTP %d after %d retries: %s", resp.StatusCode, maxRetries, string(respBytes))
		}
		return nil, fmt.Errorf("discovery download unexpected HTTP %d: %s", resp.StatusCode, string(respBytes))
	}

	return nil, fmt.Errorf("failed to fetch discovery CSV after %d retries", maxRetries)
}

// fetchCocCSV fetches a migration or cutover report ZIP (prepare-download → GET by token).
// The ZIP typically contains a bundle folder (e.g. coc-report.csv and list CSVs), not a lone root file.
func fetchCocCSV(jobRunID string) ([]byte, error) {
	prepareURL := ADMIN_SERVICE_URL + INVENTORY_PREPARE_DOWNLOAD_ENDPOINT
	payload := map[string]interface{}{
		"jobRunId":    jobRunID, // single string, not an array
		"report-type": "COC",
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal prepare-download request: %w", err)
	}

	headers := GetHeaders(AuthToken, ContentTypeJSON)

	const maxRetries = MaxPollRetries
	const retryDelay = DefaultPollInterval

	Wait(20)

	// Step 1: POST prepare-download — retry until the worker's ZIP is ready.
	var token string
	for attempt := 1; attempt <= maxRetries; attempt++ {
		LogDebug(fmt.Sprintf("Preparing COC CSV download for ID %s, attempt %d", jobRunID, attempt))

		resp, err := SendAPIRequest(http.MethodPost, prepareURL, bodyBytes, headers)
		if err != nil {
			return nil, fmt.Errorf("POST %s: %w", prepareURL, err)
		}
		respBytes, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("read prepare-download response: %w", readErr)
		}

		if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated {
			// Standard NDM envelope: { "data": { "items": { "token": "..." } } }
			var result struct {
				Data struct {
					Items struct {
						Token string `json:"token"`
					} `json:"items"`
					Token string `json:"token"`
				} `json:"data"`
				Token string `json:"token"`
			}
			if err := json.Unmarshal(respBytes, &result); err != nil {
				return nil, fmt.Errorf("parse prepare-download response: %w", err)
			}
			token = result.Data.Items.Token
			if token == "" {
				token = result.Data.Token
			}
			if token == "" {
				token = result.Token
			}
			if token == "" {
				return nil, fmt.Errorf("prepare-download returned empty token, body: %s", string(respBytes))
			}
			break
		}

		// 404 = ZIP not ready yet; 500 = transient — retry both.
		if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusInternalServerError {
			if attempt < maxRetries {
				Wait(retryDelay)
				continue
			}
			return nil, fmt.Errorf("prepare-download HTTP %d after %d retries: %s", resp.StatusCode, maxRetries, string(respBytes))
		}

		return nil, fmt.Errorf("prepare-download unexpected HTTP %d: %s", resp.StatusCode, string(respBytes))
	}

	if token == "" {
		return nil, fmt.Errorf("failed to obtain download token after %d retries", maxRetries)
	}

	// Step 2: GET /inventory/download/:token — one-time use, no auth required.
	downloadURL := ADMIN_SERVICE_URL + INVENTORY_DOWNLOAD_BY_TOKEN_ENDPOINT + token
	LogDebug(fmt.Sprintf("Downloading COC CSV for ID %s via token", jobRunID))

	resp, err := SendAPIRequest(http.MethodGet, downloadURL, nil, map[string]string{})
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", downloadURL, err)
	}
	defer resp.Body.Close()

	zipBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read download response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download-by-token unexpected HTTP %d: %s", resp.StatusCode, string(zipBytes))
	}

	return zipBytes, nil
}

// fetchPDFReport POSTs to the PDF generate endpoint and returns the raw PDF bytes.
func fetchPDFReport(jobRunID string, reportType string) ([]byte, error) {
	url := ADMIN_SERVICE_URL + "/api/v1/report/pdf/generate"
	payload := map[string]interface{}{
		"jobRunId":    jobRunID,
		"report-type": reportType,
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal PDF request: %w", err)
	}

	headers := GetHeaders(AuthToken, ContentTypeJSON)

	Wait(20)

	const maxRetries = MaxPollRetries
	const retryDelay = DefaultPollInterval

	for attempt := 1; attempt <= maxRetries; attempt++ {
		LogDebug(fmt.Sprintf("Getting PDF report for %s ID %s, attempt %d", reportType, jobRunID, attempt))

		resp, err := SendAPIRequest(http.MethodPost, url, bodyBytes, headers)
		if err != nil {
			return nil, fmt.Errorf("POST %s: %w", url, err)
		}

		respBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("read PDF response: %w", err)
		}

		if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated {
			return respBytes, nil
		}

		if resp.StatusCode == http.StatusInternalServerError || resp.StatusCode == http.StatusNotFound {
			if attempt < maxRetries {
				Wait(retryDelay)
				continue
			}
			return nil, fmt.Errorf("PDF report HTTP %d after %d retries: %s", resp.StatusCode, maxRetries, string(respBytes))
		}

		return nil, fmt.Errorf("PDF report unexpected HTTP %d: %s", resp.StatusCode, string(respBytes))
	}

	return nil, fmt.Errorf("failed to fetch PDF report after %d retries", maxRetries)
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
	// Sort keys by length descending to avoid substring replacement issues
	// (e.g., "volSMBAuto_vol1" must be replaced before "vol1" to avoid partial matches)
	jsonContent := string(raw)
	if volumeReplacements != nil {
		// Extract keys and sort by length (longest first)
		keys := make([]string, 0, len(volumeReplacements))
		for k := range volumeReplacements {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool {
			return len(keys[i]) > len(keys[j])
		})

		// Perform replacements in order (longest keys first)
		for _, oldVol := range keys {
			newVol := volumeReplacements[oldVol]
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

// normalizeZipEntryPath converts ZIP internal names to forward slashes and trims
// "./" so nested paths (folder/file.csv) match consistently across OS zip tools.
func normalizeZipEntryPath(name string) string {
	s := strings.ReplaceAll(name, "\\", "/")
	s = strings.TrimPrefix(s, "./")
	return strings.TrimSpace(s)
}

// safeZipEntryRelativePath returns a lexical path for a ZIP member with ".." and "."
// resolved, or ok=false if the entry attempts Zip Slip (traversal above the archive root)
// or uses an absolute / unsafe name. Keys used for in-memory maps must not contain raw "..".
func safeZipEntryRelativePath(name string) (rel string, ok bool) {
	s := normalizeZipEntryPath(name)
	if s == "" {
		return "", false
	}
	if path.IsAbs(s) {
		return "", false
	}
	// Reject Windows-style roots in member names (e.g. C:/...)
	if strings.Contains(s, ":") {
		return "", false
	}
	var stack []string
	for _, p := range strings.Split(s, "/") {
		if p == "" || p == "." {
			continue
		}
		if p == ".." {
			if len(stack) == 0 {
				return "", false
			}
			stack = stack[:len(stack)-1]
		} else {
			stack = append(stack, p)
		}
	}
	if len(stack) == 0 {
		return "", false
	}
	return strings.Join(stack, "/"), true
}

// readValidatedZipCSVEntry reads one ZIP member's body only after the entry name is validated as
// Zip Slip–safe (see safeZipEntryRelativePath). The archive/zip reader does not write to f.Name
// on disk, but we must not use unsanitized names as map keys or in path logic.
func readValidatedZipCSVEntry(f *zip.File) (rel string, data []byte, skip bool, err error) {
	// Defense in depth for CodeQL go/zipslip: documented pattern is to reject ".." in the raw
	// entry name before any use (https://codeql.github.com/codeql-query-help/go/go-zipslip/).
	if strings.Contains(f.Name, "..") {
		return "", nil, true, nil
	}
	rel, ok := safeZipEntryRelativePath(f.Name)
	if !ok {
		return "", nil, true, nil
	}
	if zipEntryIsSkippable(rel) {
		return "", nil, true, nil
	}
	if !strings.HasSuffix(strings.ToLower(rel), ".csv") {
		return "", nil, true, nil
	}
	rc, err := f.Open()
	if err != nil {
		return "", nil, false, fmt.Errorf("open csv in zip: %w", err)
	}
	defer rc.Close()
	data, err = io.ReadAll(rc)
	if err != nil {
		return "", nil, false, fmt.Errorf("read csv in zip: %w", err)
	}
	return rel, data, false, nil
}

// zipEntryIsSkippable returns true for directory placeholders and macOS metadata trees.
func zipEntryIsSkippable(normalizedName string) bool {
	if normalizedName == "" {
		return true
	}
	lower := strings.ToLower(normalizedName)
	if strings.HasSuffix(lower, "/") {
		return true
	}
	if strings.HasPrefix(lower, "__macosx/") {
		return true
	}
	return false
}

// extractCSVFilesFromZip takes ZIP bytes and returns all CSV file bytes keyed by normalized ZIP path.
// CSVs may live under a single folder inside the archive (e.g. jobRunId-coc-report/coc-report.csv).
func extractCSVFilesFromZip(zipData []byte) (map[string][]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return nil, fmt.Errorf("open zip: %w", err)
	}
	csvFiles := make(map[string][]byte)
	for _, f := range zr.File {
		rel, csvBytes, skip, err := readValidatedZipCSVEntry(f)
		if skip {
			continue
		}
		if err != nil {
			return nil, err
		}
		csvFiles[rel] = csvBytes
	}
	if len(csvFiles) == 0 {
		return nil, fmt.Errorf("no CSV file found in zip")
	}
	return csvFiles, nil
}

// pickCSVForValidation selects the best CSV file from a ZIP for single-spec validation.
// ZIP paths may include a parent folder (e.g. uuid-coc-report/coc-report.csv); matching uses path.Base.
// Preference order:
//   1) Discovery: *discovery-report.csv
//   2) Migration/Cutover: *coc-report.csv
//   3) Fallback: lexicographically first CSV path in ZIP
func pickCSVForValidation(csvFiles map[string][]byte, jobType JobType) (string, []byte, error) {
	if len(csvFiles) == 0 {
		return "", nil, fmt.Errorf("no CSV files available")
	}

	keys := make([]string, 0, len(csvFiles))
	for k := range csvFiles {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	containsName := func(name string) (string, bool) {
		needle := strings.ToLower(name)
		for _, k := range keys {
			base := path.Base(normalizeZipEntryPath(k))
			if strings.Contains(strings.ToLower(base), needle) {
				return k, true
			}
		}
		return "", false
	}

	if jobType == JobTypeDiscovery {
		if k, ok := containsName("discovery-report.csv"); ok {
			return k, csvFiles[k], nil
		}
	}

	if jobType == JobTypeMigration || jobType == JobTypeCutover {
		if k, ok := containsName("coc-report.csv"); ok {
			return k, csvFiles[k], nil
		}
	}

	fallback := keys[0]
	return fallback, csvFiles[fallback], nil
}

// cleanup closes the file and removes it from disk.
func cleanup(f *os.File) {
	f.Close()
	os.Remove(f.Name())
}

// countCocBundleCSVRows is a shared helper that downloads the CoC ZIP for the
// given job run, finds a CSV whose base name contains csvNameContains, and
// returns the number of data rows (header excluded).
func countCocBundleCSVRows(jobRunID, csvNameContains string) (int, error) {
	data, err := fetchCocCSV(jobRunID)
	if err != nil {
		return 0, fmt.Errorf("countCocBundleCSVRows(%s): fetch CoC ZIP for job %s: %w", csvNameContains, jobRunID, err)
	}

	csvFiles, err := extractCSVFilesFromZip(data)
	if err != nil {
		return 0, fmt.Errorf("countCocBundleCSVRows(%s): extract ZIP for job %s: %w", csvNameContains, jobRunID, err)
	}

	needle := strings.ToLower(csvNameContains)
	var csvBytes []byte
	for zipPath, b := range csvFiles {
		if strings.Contains(strings.ToLower(path.Base(normalizeZipEntryPath(zipPath))), needle) {
			csvBytes = b
			break
		}
	}
	if csvBytes == nil {
		return 0, fmt.Errorf("countCocBundleCSVRows: %q not found in CoC ZIP for job %s", csvNameContains, jobRunID)
	}

	reader := csv.NewReader(bytes.NewReader(csvBytes))
	// Skip header row
	if _, err := reader.Read(); err != nil {
		return 0, fmt.Errorf("countCocBundleCSVRows(%s): read header for job %s: %w", csvNameContains, jobRunID, err)
	}

	count := 0
	for {
		if _, err := reader.Read(); err != nil {
			break
		}
		count++
	}
	return count, nil
}

// CountMigrationReportRows returns the number of rows in coc-report.csv
func CountMigrationReportRows(jobRunID string) (int, error) {
	count, err := countCocBundleCSVRows(jobRunID, "coc-report.csv")
	if err != nil {
		return 0, fmt.Errorf("CountMigrationReportRows: %w", err)
	}
	LogDebug(fmt.Sprintf("CountMigrationReportRows: job %s transferred %d files", jobRunID, count))
	return count, nil
}

// CountDeletedReportRows returns the number of rows in deleted-report.csv
func CountDeletedReportRows(jobRunID string) (int, error) {
	count, err := countCocBundleCSVRows(jobRunID, "deleted-report.csv")
	if err != nil {
		return 0, fmt.Errorf("CountDeletedReportRows: %w", err)
	}
	LogDebug(fmt.Sprintf("CountDeletedReportRows: job %s deleted %d files from destination", jobRunID, count))
	return count, nil
}
