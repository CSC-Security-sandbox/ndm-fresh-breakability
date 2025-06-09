package utils

import (
    "log"
    "regexp"
)
 
func sanitize(msg string) string {
    patterns := []string{
        `(?i)(password\s*[:=]?\s*)\S+`,
        `(?i)(token\s*[:=]?\s*)\S+`,
        `(?i)(email\s*[:=]?\s*)\S+`,
    }
    for _, pattern := range patterns {
        re := regexp.MustCompile(pattern)
        msg = re.ReplaceAllString(msg, "$1[REDACTED]")
    }
 
    return msg
}
    
func LogDebug(msg string) {
    safeMsg := sanitize(msg)
    log.Print("[DEBUG] " + safeMsg)
}

func LogError(msg string, err ...error) {
    if len(err) > 0 && err[0] != nil {
        log.Print("[ERROR] " + msg + " | Error: " + err[0].Error())
    } else {
        log.Print("[ERROR] " + msg)
    }
}

func LogFatalf(format string, args ...interface{}) {
	log.Fatalf("[FATAL] "+format, args...)
}