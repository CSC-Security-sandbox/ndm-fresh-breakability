package utils

import (
    "log"
    "regexp"
)

var compiledPatterns = []*regexp.Regexp{
   regexp.MustCompile(`(?i)(password\s*[:=]?\s*)\S+`),
   regexp.MustCompile(`(?i)(token\s*[:=]?\s*)\S+`),
   regexp.MustCompile(`(?i)(email\s*[:=]?\s*)\S+`),
}

func sanitize(msg string) string {
    for _, re := range compiledPatterns {
        msg = re.ReplaceAllString(msg, "$1[REDACTED]")
    }
 
    return msg
}
    
func LogDebug(msg string) {
    // sanitisedMessage := sanitize(msg)
    log.Print("[DEBUG] " + msg)
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
