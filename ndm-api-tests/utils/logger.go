package utils

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

// getCallerInfo returns the test name (without line number) of the caller
func getCallerInfo() string {
	// Try to get current test name from Ginkgo environment variable
	// This is set by Ginkgo during test execution
	testName := os.Getenv("CURRENT_TEST_CASE")

	// If we have a test name, extract only the part before the colon for cleaner output
	if testName != "" {
		// Extract test ID before the colon (e.g., "TC-SMB-PERMISSIONS-001" from "TC-SMB-PERMISSIONS-001: Test description")
		if colonIndex := strings.Index(testName, ":"); colonIndex != -1 {
			testName = strings.TrimSpace(testName[:colonIndex])
		}
		return fmt.Sprintf("[%s]", testName)
	}

	// Skip 2 frames: getCallerInfo and LogDebug/LogError
	_, file, line, ok := runtime.Caller(2)
	if !ok {
		return ""
	}

	// Get just the filename without full path
	filename := filepath.Base(file)

	// Remove _test.go suffix if present for cleaner output
	filename = strings.TrimSuffix(filename, "_test.go")
	filename = strings.TrimSuffix(filename, ".go")

	return fmt.Sprintf("[%s:%d]", filename, line)
}

// sanitizeMessage redacts sensitive information from log messages
func sanitizeMessage(msg string) string {
	// List of sensitive field patterns to redact
	// Matches patterns like: password:"value", Password:"value", adPassword:"value"
	// Also matches: password: value, Password:value (with or without quotes)
	patterns := []string{
		`(?i)(password|passwd|pwd|secret|token|apikey|api_key|auth|authorization)[\s]*:[\s]*"[^"]*"`,
		`(?i)(password|passwd|pwd|secret|token|apikey|api_key|auth|authorization)[\s]*:[\s]*[^\s,}\]]+`,
		`(?i)(password|passwd|pwd|secret|token|apikey|api_key|auth|authorization)[\s]*=[\s]*"[^"]*"`,
		`(?i)(password|passwd|pwd|secret|token|apikey|api_key|auth|authorization)[\s]*=[\s]*[^\s,}\]]+`,
	}
	
	sanitized := msg
	for _, pattern := range patterns {
		re := regexp.MustCompile(pattern)
		sanitized = re.ReplaceAllStringFunc(sanitized, func(match string) string {
			// Extract the field name (everything before : or =)
			parts := regexp.MustCompile(`[\s]*[:=][\s]*`).Split(match, 2)
			if len(parts) > 0 {
				return parts[0] + ":***REDACTED***"
			}
			return "***REDACTED***"
		})
	}
	
	return sanitized
}

// LogDebug logs debug messages with caller information and sanitizes sensitive data.
func LogDebug(msg string) {
	sanitized := sanitizeMessage(msg)
	caller := getCallerInfo()
	if caller != "" {
		log.Print("[DEBUG] " + caller + " " + sanitized)
	} else {
		log.Print("[DEBUG] " + sanitized)
	}
}

func LogError(msg string, err ...error) {
	sanitized := sanitizeMessage(msg)
	caller := getCallerInfo()
	prefix := "[ERROR] "
	if caller != "" {
		prefix += caller + " "
	}

	if len(err) > 0 && err[0] != nil {
		log.Print(prefix + sanitized + " | Error: " + err[0].Error())
	} else {
		log.Print(prefix + sanitized)
	}
}

func LogFatalf(format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	sanitized := sanitizeMessage(msg)
	caller := getCallerInfo()
	if caller != "" {
		log.Fatal("[FATAL] " + caller + " " + sanitized)
	} else {
		log.Fatal("[FATAL] " + sanitized)
	}
}
