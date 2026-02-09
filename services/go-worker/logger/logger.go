package logger

import (
	"regexp"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// ipPattern matches IPv4 addresses so the last octet can be masked in log
// output, reducing the risk of leaking full IP addresses.
var ipPattern = regexp.MustCompile(`(\d{1,3}\.\d{1,3}\.\d{1,3}\.)\d{1,3}`)

// Logger is a structured logging wrapper around zap.Logger. It provides a
// simplified interface with context field injection (e.g. trackId) and IP
// masking, mirroring the behaviour of the TypeScript @netapp-cloud-datamigrate/logger-lib.
type Logger struct {
	zap     *zap.Logger
	context []zap.Field
}

// NewLogger creates a production-ready Logger that writes JSON-encoded log
// entries to stdout. The name parameter is attached to every log entry and is
// typically the service or component name.
func NewLogger(name string) *Logger {
	cfg := zap.Config{
		Level:       zap.NewAtomicLevelAt(zap.DebugLevel),
		Development: false,
		Encoding:    "json",
		EncoderConfig: zapcore.EncoderConfig{
			TimeKey:        "timestamp",
			LevelKey:       "level",
			NameKey:        "logger",
			CallerKey:      "caller",
			MessageKey:     "message",
			StacktraceKey:  "stacktrace",
			LineEnding:     zapcore.DefaultLineEnding,
			EncodeLevel:    zapcore.LowercaseLevelEncoder,
			EncodeTime:     zapcore.ISO8601TimeEncoder,
			EncodeDuration: zapcore.MillisDurationEncoder,
			EncodeCaller:   zapcore.ShortCallerEncoder,
		},
		OutputPaths:      []string{"stdout"},
		ErrorOutputPaths: []string{"stderr"},
	}

	zapLogger, err := cfg.Build(zap.AddCallerSkip(1))
	if err != nil {
		// Fall back to a no-op logger if configuration is somehow invalid.
		// In practice this should never happen with the hard-coded config above.
		zapLogger = zap.NewNop()
	}

	return &Logger{
		zap:     zapLogger.Named(name),
		context: nil,
	}
}

// WithTrackID returns a new Logger that includes a "trackId" field in every
// log entry. The original Logger is not modified.
func (l *Logger) WithTrackID(trackID string) *Logger {
	newContext := make([]zap.Field, len(l.context), len(l.context)+1)
	copy(newContext, l.context)
	newContext = append(newContext, zap.String("trackId", trackID))

	return &Logger{
		zap:     l.zap,
		context: newContext,
	}
}

// Info logs a message at InfoLevel with optional structured fields.
func (l *Logger) Info(msg string, fields ...zap.Field) {
	l.zap.Info(msg, l.mergeFields(fields)...)
}

// Error logs a message at ErrorLevel with optional structured fields.
func (l *Logger) Error(msg string, fields ...zap.Field) {
	l.zap.Error(msg, l.mergeFields(fields)...)
}

// Debug logs a message at DebugLevel with optional structured fields.
func (l *Logger) Debug(msg string, fields ...zap.Field) {
	l.zap.Debug(msg, l.mergeFields(fields)...)
}

// Warn logs a message at WarnLevel with optional structured fields.
func (l *Logger) Warn(msg string, fields ...zap.Field) {
	l.zap.Warn(msg, l.mergeFields(fields)...)
}

// MaskIPs replaces the last octet of every IPv4 address found in s with "***",
// reducing the risk of logging full IP addresses. For example,
// "192.168.1.100" becomes "192.168.1.***".
func MaskIPs(s string) string {
	return ipPattern.ReplaceAllString(s, "${1}***")
}

// Sync flushes any buffered log entries. Applications should call Sync before
// exiting.
func (l *Logger) Sync() error {
	return l.zap.Sync()
}

// Underlying returns the raw *zap.Logger for use in libraries that require it
// directly (e.g. gRPC interceptors).
func (l *Logger) Underlying() *zap.Logger {
	return l.zap
}

// mergeFields combines the logger's context fields with any additional fields
// supplied at the call site. Context fields come first so that call-site
// fields can override them if needed.
func (l *Logger) mergeFields(fields []zap.Field) []zap.Field {
	if len(l.context) == 0 {
		return fields
	}
	merged := make([]zap.Field, 0, len(l.context)+len(fields))
	merged = append(merged, l.context...)
	merged = append(merged, fields...)
	return merged
}
