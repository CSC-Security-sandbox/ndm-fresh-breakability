package workflows

import "time"

// ChildScanWorkflowInput is the input for the ChildScanWorkflow.
// Wire-compatible with the TypeScript ChildScanWorkflowInput interface.
type ChildScanWorkflowInput struct {
	JobRunID           string   `json:"jobRunId"`
	DirsToScan         []string `json:"dirsToScan"`
	DirBatchIds        []string `json:"dirBatchIds"`
	BatchSize          int      `json:"batchSize"`
	FileCount          int      `json:"fileCount"`
	DirCount           int      `json:"dirCount"`
	IsMigration        bool     `json:"isMigration"`
	ActionState        string   `json:"actionState"`
	IsInitialScan      bool     `json:"isInitialScan"`
	WorkerConcurrency  int      `json:"workerConcurrency"`
}

// ChildScanWorkflowOutput is the output for the ChildScanWorkflow.
type ChildScanWorkflowOutput struct {
	JobRunID  string `json:"jobRunId"`
	FileCount int    `json:"fileCount"`
	DirCount  int    `json:"dirCount"`
	Status    string `json:"status"`
	Error     string `json:"error,omitempty"`
}

// ExecuteBatchScanInput is used within ChildScanWorkflow to execute a batch of
// directory scans.
type ExecuteBatchScanInput struct {
	Batches     []string `json:"batches"`
	JobRunID    string   `json:"jobRunId"`
	IsMigration bool     `json:"isMigration"`
	BatchSize   int      `json:"batchSize"`
}

// ExecuteBatchScansOutput aggregates results from a batch of scans.
type ExecuteBatchScansOutput struct {
	FileCount int      `json:"fileCount"`
	DirCount  int      `json:"dirCount"`
	BatchDirs []string `json:"batchDirs"`
	Error     string   `json:"error,omitempty"`
}

// ChildSyncWorkflowInput is the input for the ChildSyncWorkflow.
// Wire-compatible with the TypeScript SyncWorkflowInput interface.
type ChildSyncWorkflowInput struct {
	JobRunID            string `json:"jobRunId"`
	ScanWorkflowStatus  string `json:"scanWorkflowStatus"`
	ActionState         string `json:"actionState"`
	WorkerConcurrency   int    `json:"workerConcurrency"`
}

// ChildSyncWorkflowOutput is the output for the ChildSyncWorkflow.
type ChildSyncWorkflowOutput struct {
	JobRunID string `json:"jobRunId"`
	Status   string `json:"status"`
	Error    string `json:"error,omitempty"`
}

// DiscoveryWorkflowInput is the input for the DiscoveryWorkflow parent.
type DiscoveryWorkflowInput struct {
	TraceID string                 `json:"traceId"`
	Payload DiscoveryPayload       `json:"payload"`
	Options map[string]interface{} `json:"options,omitempty"`
}

// DiscoveryPayload contains worker IDs for discovery.
type DiscoveryPayload struct {
	Workers []string `json:"workers"`
}

// DiscoveryWorkflowOutput is the output for the DiscoveryWorkflow parent.
type DiscoveryWorkflowOutput struct {
	TraceID               string   `json:"traceId"`
	SetupCompletedWorkers []string `json:"setupCompletedWorkers"`
	FailedWorkers         []string `json:"failedWorkers"`
	FileCount             int      `json:"fileCount"`
	DirCount              int      `json:"dirCount"`
	Status                string   `json:"status"`
}

// MigrationWorkflowInput is the input for the MigrationWorkflow parent.
type MigrationWorkflowInput struct {
	TraceID string                 `json:"traceId"`
	Payload MigrationPayload       `json:"payload"`
	Options map[string]interface{} `json:"options,omitempty"`
}

// MigrationPayload contains worker IDs for migration.
type MigrationPayload struct {
	Workers []string `json:"workers"`
}

// MigrationWorkflowOutput is the output for the MigrationWorkflow parent.
type MigrationWorkflowOutput struct {
	TraceID               string   `json:"traceId"`
	SetupCompletedWorkers []string `json:"setupCompletedWorkers"`
	FailedWorkers         []string `json:"failedWorkers"`
	FileCount             int      `json:"fileCount"`
	DirCount              int      `json:"dirCount"`
	Status                string   `json:"status"`
}

// CutOverWorkflowInput is the input for the CutOverWorkFlow parent.
type CutOverWorkflowInput struct {
	TraceID string                 `json:"traceId"`
	Payload CutOverPayload         `json:"payload"`
	Options map[string]interface{} `json:"options,omitempty"`
}

// CutOverPayload contains worker IDs for cutover.
type CutOverPayload struct {
	Workers []string `json:"workers"`
}

// CutOverWorkflowOutput is the output for the CutOverWorkFlow parent.
type CutOverWorkflowOutput struct {
	TraceID               string   `json:"traceId"`
	SetupCompletedWorkers []string `json:"setupCompletedWorkers"`
	FailedWorkers         []string `json:"failedWorkers"`
	FileCount             int      `json:"fileCount"`
	DirCount              int      `json:"dirCount"`
	Status                string   `json:"status"`
}

// SetupWorkerInput is the input for the SetupWorkerWorkflow.
type SetupWorkerInput struct {
	JobRunID string `json:"jobRunId"`
}

// SetupWorkerOutput is the output for the SetupWorkerWorkflow.
type SetupWorkerOutput struct {
	Status   string `json:"status"`
	Message  string `json:"message,omitempty"`
	WorkerID string `json:"workerId,omitempty"`
}

// CleanupWorkerInput is the input for the CleanupWorkerWorkflow.
type CleanupWorkerInput struct {
	JobRunID string `json:"jobRunId"`
}

// ValidateConnectionInput is the input for the ValidateConnectionWorkflow.
type ValidateConnectionInput struct {
	TraceID    string                 `json:"traceId"`
	FileServer interface{}            `json:"fileServer"`
	Feature    string                 `json:"feature,omitempty"`
}

// ValidatePathInput is the input for the ValidatePathWorkflow.
type ValidatePathInput struct {
	TraceID    string      `json:"traceId"`
	Paths      interface{} `json:"paths"`
	FileServer interface{} `json:"fileServer"`
	WorkerID   string      `json:"workerId,omitempty"`
}

// ListPathInput is the input for the ListPathWorkflow.
type ListPathInput struct {
	TraceID    string      `json:"traceId"`
	FileServer interface{} `json:"fileServer"`
}

// PreCheckInput is the input for the PreCheckWorkflow.
type PreCheckInput struct {
	TraceID  string      `json:"traceId"`
	Payload  interface{} `json:"payload"`
	Options  interface{} `json:"options,omitempty"`
}

// SpeedTestInput is the input for the SpeedTestWorkflow.
type SpeedTestInput struct {
	TraceID string      `json:"traceId"`
	Payload interface{} `json:"payload"`
	Options interface{} `json:"options,omitempty"`
}

// RedisMemCheckInput is the input for the RedisMemCheckWorkflow.
type RedisMemCheckInput struct {
	TraceID string `json:"traceId"`
}

// WorkingDirectoryInput is the input for the WorkingDirectoryWorkflow.
type WorkingDirectoryInput struct {
	TraceID string      `json:"traceId"`
	Payload interface{} `json:"payload"`
	Options interface{} `json:"options,omitempty"`
}

// ApprovalInput is the input for the waitForApproval helper.
type ApprovalInput struct {
	JobRunID string `json:"jobRunId"`
}

// ReportingInput is the input for the handleReporting helper.
type ReportingInput struct {
	JobRunID string `json:"jobRunId"`
	JobType  string `json:"jobType"`
}

// UpdateStatusInput matches the TypeScript UpdateStatusInput.
type UpdateStatusInput struct {
	JobRunID string `json:"jobRunId"`
	Status   string `json:"status"`
}

// UpdateCutOverStatusInput matches the TypeScript UpdateCutOverStatusInput.
type UpdateCutOverStatusInput struct {
	JobRunID string `json:"jobRunId"`
	Status   string `json:"status"`
}

// ScanActivityInput is used to call the scanDirectories activity.
type ScanActivityInput struct {
	JobRunID    string `json:"jobRunId"`
	BatchID     string `json:"batchId"`
	BatchSize   int    `json:"batchSize"`
	IsMigration bool   `json:"isMigration"`
}

// ScanActivityOutput is the result from the scanDirectories activity.
type ScanActivityOutput struct {
	FileCount int      `json:"fileCount"`
	DirCount  int      `json:"dirCount"`
	BatchDirs []string `json:"batchDirs"`
	Error     string   `json:"error,omitempty"`
}

// SyncTaskActivityInput is the input for the syncTaskActivity.
type SyncTaskActivityInput struct {
	JobRunID string `json:"jobRunId"`
	TaskID   string `json:"taskId"`
}

// SyncTaskActivityOutput is the output from the syncTaskActivity.
type SyncTaskActivityOutput struct {
	TaskID string `json:"taskId"`
	Error  string `json:"error,omitempty"`
}

// WorkerResponseInput is used for updateWorkerResponse activity calls.
type WorkerResponseInput struct {
	Status     string    `json:"status"`
	Code       string    `json:"code"`
	Operation  string    `json:"operation"`
	Occurrence int       `json:"occurrence"`
	Origin     string    `json:"origin"`
	Message    string    `json:"message"`
	CreatedAt  time.Time `json:"createdAt"`
}

// MigrationChildWorkflowsOutput is the internal result of
// executeMigrationChildWorkflows.
type MigrationChildWorkflowsOutput struct {
	Status        string `json:"status"`
	FileCount     int    `json:"fileCount"`
	DirCount      int    `json:"dirCount"`
	ScanJobStatus string `json:"scanJobStatus"`
	SyncJobStatus string `json:"syncJobStatus"`
}

// DiscoveryChildWorkflowsOutput is the internal result of
// executeDiscoveryChildWorkflows.
type DiscoveryChildWorkflowsOutput struct {
	Status    string `json:"status"`
	FileCount int    `json:"fileCount"`
	DirCount  int    `json:"dirCount"`
}

// ExecuteWorkerSetupInput is the input for executeWorkerSetup.
type ExecuteWorkerSetupInput struct {
	JobRunID  string                 `json:"jobRunId"`
	WorkerIDs []string               `json:"workerIds"`
	Options   map[string]interface{} `json:"options,omitempty"`
}

// ExecuteWorkerSetupOutput is the output for executeWorkerSetup.
type ExecuteWorkerSetupOutput struct {
	SetupCompletedWorkers []string `json:"setupCompletedWorkers"`
	FailedWorkers         []string `json:"failedWorkers"`
}

// ExecuteCleanupInput is the input for executeCleanup.
type ExecuteCleanupInput struct {
	JobRunID  string                 `json:"jobRunId"`
	WorkerIDs []string               `json:"workerIds"`
	Options   map[string]interface{} `json:"options,omitempty"`
}

// CreateInitialDirBatchInput is the input for the createInitialDirBatch activity.
type CreateInitialDirBatchInput struct {
	DirsToScan []string `json:"dirsToScan"`
	JobRunID   string   `json:"jobRunId"`
}

// ValidatePathActivityInput is used by the ValidatePathWorkerWorkflow to call
// the validatePath activity.
type ValidatePathActivityInput struct {
	Path            string `json:"path"`
	Host            string `json:"host"`
	Username        string `json:"username"`
	Password        string `json:"password"`
	Protocol        string `json:"protocol"`
	UploadID        string `json:"uploadId"`
	ProtocolVersion string `json:"protocolVersion"`
	PathID          string `json:"pathId"`
}

// CutOverStatus constants match the TypeScript CutOverStatus enum.
const (
	CutOverStatusApproved = "APPROVED"
	CutOverStatusRejected = "REJECTED"
)

// JobReportType constants match the TypeScript JobReportType enum used in
// reporting signals.
const (
	JobReportTypeMigrate = "MIGRATE_REPORTED"
	JobReportTypeCutOver = "CUT_OVER_REPORTED"
	JobReportTypeDiscover = "DISCOVER_REPORTED"
)

// JobRunStatus constants for use in workflows. These match the TypeScript
// JobRunStatus enum values exactly.
const (
	StatusReady     = "READY"
	StatusPending   = "PENDING"
	StatusRunning   = "RUNNING"
	StatusPaused    = "PAUSED"
	StatusStopped   = "STOPPED"
	StatusCompleted = "COMPLETED"
	StatusFailed    = "FAILED"
	StatusBlocked   = "BLOCKED"
	StatusErrored   = "ERRORED"
)
