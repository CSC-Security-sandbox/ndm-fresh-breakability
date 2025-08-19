package performance

import "log"

// LogDebug logs debug messages.
func LogDebug(msg string) {
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
