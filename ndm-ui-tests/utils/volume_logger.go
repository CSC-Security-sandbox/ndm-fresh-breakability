package utils

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// LogDebug logs a debug message with caller context, redacting sensitive fields.
// Signature matches ndm-api-tests/utils LogDebug so ported files compile unchanged.
func LogDebug(msg string) {
	sanitized := redactSensitive(msg)
	caller := volumeCallerInfo()
	if caller != "" {
		log.Print("[VOLUME-DEBUG] " + caller + " " + sanitized)
	} else {
		log.Print("[VOLUME-DEBUG] " + sanitized)
	}
}

// LogError logs an error message.
func LogError(msg string, errs ...error) {
	sanitized := redactSensitive(msg)
	caller := volumeCallerInfo()
	prefix := "[VOLUME-ERROR] "
	if caller != "" {
		prefix += caller + " "
	}
	if len(errs) > 0 && errs[0] != nil {
		log.Print(prefix + sanitized + " | " + errs[0].Error())
	} else {
		log.Print(prefix + sanitized)
	}
}

// volumeCallerInfo returns a short "file:line" tag for the call site.
func volumeCallerInfo() string {
	if testCase := os.Getenv("CURRENT_TEST_CASE"); testCase != "" {
		if idx := strings.Index(testCase, ":"); idx != -1 {
			testCase = strings.TrimSpace(testCase[:idx])
		}
		return fmt.Sprintf("[%s]", testCase)
	}
	_, file, line, ok := runtime.Caller(2)
	if !ok {
		return ""
	}
	name := filepath.Base(file)
	name = strings.TrimSuffix(name, "_test.go")
	name = strings.TrimSuffix(name, ".go")
	return fmt.Sprintf("[%s:%d]", name, line)
}

// redactSensitive removes passwords and secrets from log lines.
func redactSensitive(msg string) string {
	// Simple keyword redaction — good enough for test log hygiene.
	keywords := []string{"password", "passwd", "secret", "token", "apikey"}
	lower := strings.ToLower(msg)
	for _, kw := range keywords {
		if !strings.Contains(lower, kw) {
			continue
		}
		// Replace the value after : or = with ***
		for _, sep := range []string{":", "="} {
			idx := strings.Index(lower, kw)
			for idx != -1 {
				sepIdx := strings.IndexAny(msg[idx:], sep)
				if sepIdx == -1 {
					break
				}
				absIdx := idx + sepIdx + 1
				end := strings.IndexAny(msg[absIdx:], " ,}\n\"")
				if end == -1 {
					end = len(msg) - absIdx
				}
				msg = msg[:absIdx] + "***" + msg[absIdx+end:]
				lower = strings.ToLower(msg)
				idx = strings.Index(lower[idx+1:], kw)
				if idx != -1 {
					idx += idx + 1
				}
				break
			}
		}
	}
	return msg
}
