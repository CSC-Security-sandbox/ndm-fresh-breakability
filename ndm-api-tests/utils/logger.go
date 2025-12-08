package utils

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
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

// LogDebug logs debug messages with caller information.
func LogDebug(msg string) {
	caller := getCallerInfo()
	if caller != "" {
		log.Print("[DEBUG] " + caller + " " + msg)
	} else {
		log.Print("[DEBUG] " + msg)
	}
}

func LogError(msg string, err ...error) {
	caller := getCallerInfo()
	prefix := "[ERROR] "
	if caller != "" {
		prefix += caller + " "
	}

	if len(err) > 0 && err[0] != nil {
		log.Print(prefix + msg + " | Error: " + err[0].Error())
	} else {
		log.Print(prefix + msg)
	}
}

func LogFatalf(format string, args ...interface{}) {
	caller := getCallerInfo()
	if caller != "" {
		log.Fatalf("[FATAL] "+caller+" "+format, args...)
	} else {
		log.Fatalf("[FATAL] "+format, args...)
	}
}
