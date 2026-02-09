package types

import "fmt"

// FatalError represents an unrecoverable error that should cause Temporal to
// mark the activity as permanently failed (non-retryable). Map this to
// temporal.NewNonRetryableApplicationError in activity code.
type FatalError struct {
	Message string
}

func (e *FatalError) Error() string {
	return fmt.Sprintf("fatal error: %s", e.Message)
}

// NewFatalError constructs a FatalError with the given message.
func NewFatalError(msg string) *FatalError {
	return &FatalError{Message: msg}
}

// RetryableError represents a transient error that Temporal should retry
// according to the activity retry policy.
type RetryableError struct {
	Message string
}

func (e *RetryableError) Error() string {
	return fmt.Sprintf("retryable error: %s", e.Message)
}

// NewRetryableError constructs a RetryableError with the given message.
func NewRetryableError(msg string) *RetryableError {
	return &RetryableError{Message: msg}
}

// RetryExceededError signals that the maximum number of retries for an
// operation has been exhausted. This should be treated as non-retryable by
// Temporal.
type RetryExceededError struct {
	Message string
}

func (e *RetryExceededError) Error() string {
	return fmt.Sprintf("retry exceeded: %s", e.Message)
}

// NewRetryExceededError constructs a RetryExceededError with the given message.
func NewRetryExceededError(msg string) *RetryExceededError {
	return &RetryExceededError{Message: msg}
}

// IsFatalError returns true when err is a FatalError or a RetryExceededError.
// Use this in Temporal activity wrappers to decide whether to wrap the error as
// a non-retryable application error.
func IsFatalError(err error) bool {
	switch err.(type) {
	case *FatalError, *RetryExceededError:
		return true
	default:
		return false
	}
}

// ErroredFile identifies a specific file that caused an error during a
// migration operation. Wire-compatible with the TypeScript ErroredFile
// interface in metadata-types.ts.
type ErroredFile struct {
	FileName string `json:"fileName" msgpack:"fileName"`
	FilePath string `json:"filePath" msgpack:"filePath"`
}

// TaskError records an error associated with a task. Wire-compatible with the
// TypeScript TaskError interface in metadata-types.ts.
type TaskError struct {
	TaskID       string `json:"taskId" msgpack:"taskId"`
	ErrorCode    string `json:"errorCode" msgpack:"errorCode"`
	ErrorMessage string `json:"errorMessage" msgpack:"errorMessage"`
	ErrorType    string `json:"errorType" msgpack:"errorType"`
	TaskType     string `json:"taskType,omitempty" msgpack:"taskType,omitempty"`
	Origin       string `json:"origin,omitempty" msgpack:"origin,omitempty"`
}

// OperationError records an error associated with a file operation. Wire-
// compatible with the TypeScript OperationError interface in
// metadata-types.ts.
type OperationError struct {
	OperationID   string      `json:"operationId" msgpack:"operationId"`
	ErrorCode     string      `json:"errorCode" msgpack:"errorCode"`
	ErrorMessage  string      `json:"errorMessage" msgpack:"errorMessage"`
	ErrorFiles    ErroredFile `json:"errorFiles" msgpack:"errorFiles"`
	ErrorType     string      `json:"errorType" msgpack:"errorType"`
	OperationName string      `json:"operationName,omitempty" msgpack:"operationName,omitempty"`
	Origin        string      `json:"origin,omitempty" msgpack:"origin,omitempty"`
}

// DMError is the top-level error record published to the Redis error stream.
// Wire-compatible with the TypeScript DMError class in metadata-types.ts.
type DMError struct {
	Tasks     *TaskError      `json:"tasks,omitempty" msgpack:"tasks,omitempty"`
	Operation *OperationError `json:"operation,omitempty" msgpack:"operation,omitempty"`
}

// NewDMError constructs a DMError with optional task and operation errors.
func NewDMError(taskErr *TaskError, opErr *OperationError) *DMError {
	return &DMError{
		Tasks:     taskErr,
		Operation: opErr,
	}
}
