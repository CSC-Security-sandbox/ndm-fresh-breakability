package workflows

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
// Wire-compatible with the TypeScript SetupOutput interface.
type SetupWorkerOutput struct {
	JobRunID     string      `json:"jobRunId"`
	Status       string      `json:"status"`
	Message      string      `json:"message,omitempty"`
	WorkerID     string      `json:"workerId,omitempty"`
	FSDetails    interface{} `json:"fsDetails,omitempty"`
	FileServerID string      `json:"fileServerId,omitempty"`
	VolumeID     string      `json:"volumeId,omitempty"`
	ProtocolType string      `json:"protocolType,omitempty"`
}

// CleanupWorkerInput is the input for the CleanupWorkerWorkflow.
type CleanupWorkerInput struct {
	JobRunID string `json:"jobRunId"`
}

// ValidateConnectionInput is the input for the ValidateConnectionsWorkflow.
// The config service wraps the real payload inside a top-level object:
//
//	{
//	  "traceId": "...",
//	  "payload": {
//	    "traceId": "...",
//	    "feature": { "enablePreListPath": false, "enableVersionFetch": false },
//	    "fileServer": { "hostname": "...", "protocols": [...] },
//	    "workerIds": ["worker-uuid-1", ...],
//	    "options": { ... }
//	  },
//	  "options": { ... }
//	}
type ValidateConnectionInput struct {
	TraceID string                 `json:"traceId"`
	Payload ValidateConnectionData `json:"payload"`
	Options interface{}            `json:"options,omitempty"`
}

// ValidateConnectionData is the nested "payload" inside
// ValidateConnectionInput that carries the actual workflow data.
type ValidateConnectionData struct {
	TraceID    string      `json:"traceId"`
	Feature    interface{} `json:"feature,omitempty"`
	FileServer interface{} `json:"fileServer"`
	WorkerIDs  []string    `json:"workerIds"`
	Options    interface{} `json:"options,omitempty"`
}

// ValidatePathsInput is the input for the ValidatePathsWorkflow (parent).
// The config service wraps the real payload inside a top-level object:
//
//	{
//	  "traceId": "...",
//	  "payload": {
//	    "traceId": "...",
//	    "paths": [{"pathId": "...", "path": "..."}],
//	    "fileServer": { "type": "NFS", "host": "...", ... },
//	    "workerIds": ["worker-uuid-1", ...]
//	  },
//	  "options": { ... }
//	}
type ValidatePathsInput struct {
	TraceID string             `json:"traceId"`
	Payload ValidatePathsData `json:"payload"`
	Options interface{}        `json:"options,omitempty"`
}

// ValidatePathsData is the nested "payload" inside ValidatePathsInput.
type ValidatePathsData struct {
	TraceID    string      `json:"traceId"`
	Paths      interface{} `json:"paths"`
	FileServer interface{} `json:"fileServer"`
	WorkerIDs  []string    `json:"workerIds"`
}

// ListPathInput is the input for the ListPathsWorkflow (parent).
// The config service wraps the real payload inside a top-level object:
//
//	{
//	  "traceId": "...",
//	  "payload": {
//	    "traceId": "...",
//	    "fileServer": { "hostname": "...", "protocols": [...] },
//	    "workerIds": ["worker-uuid-1", ...],
//	    "options": { ... }
//	  },
//	  "options": { ... }
//	}
type ListPathInput struct {
	TraceID string        `json:"traceId"`
	Payload ListPathData  `json:"payload"`
	Options interface{}   `json:"options,omitempty"`
}

// ListPathData is the nested "payload" inside ListPathInput.
type ListPathData struct {
	TraceID    string      `json:"traceId"`
	FileServer interface{} `json:"fileServer"`
	WorkerIDs  []string    `json:"workerIds"`
	Options    interface{} `json:"options,omitempty"`
}

// PreCheckInput is the input for the PreCheckWorkflow.
type PreCheckInput struct {
	TraceID string      `json:"traceId"`
	Payload interface{} `json:"payload"`
	Options interface{} `json:"options,omitempty"`
}

// PreCheckWorkflowResponse matches the TypeScript PreCheckWorkflowResponse
// interface returned by the parent PreCheckValidationWorkflow.
type PreCheckWorkflowResponse struct {
	SourcePathID string                       `json:"sourcePathId"`
	Status       string                       `json:"status"`
	Destination  []PreCheckDestinationStatus  `json:"destination"`
	Errors       []string                     `json:"errors"`
}

// PreCheckDestinationStatus matches the TypeScript PreCheckDestinationStatus
// interface.
type PreCheckDestinationStatus struct {
	DestinationPathID string         `json:"destinationPathId"`
	Status            string         `json:"status"`
	Errors            []string       `json:"errors"`
	CommonWorkers     []WorkerRecord `json:"commonWorkers"`
	Warnings          []string       `json:"warnings"`
}

// WorkerRecord matches the TypeScript workerRecord interface.
type WorkerRecord struct {
	WorkerID  string `json:"workerId"`
	IsHealthy bool   `json:"ishealthy"`
}

// PreCheckPathResult is the typed version of the activity output used during
// result aggregation in the parent workflow.
type PreCheckPathResult struct {
	PathID                    string   `json:"pathId"`
	Status                    string   `json:"status"`
	ErrorCodes                []string `json:"errorCodes"`
	WorkerID                  string   `json:"workerId"`
	SourceDataSize            *int64   `json:"sourceDataSize,omitempty"`
	DestinationAvailableSpace *int64   `json:"destinationAvailableSpace,omitempty"`
}

// PreCheckWorkerResult is the typed version of the child workflow output.
type PreCheckWorkerResult struct {
	WorkerID string               `json:"workerId"`
	Paths    []PreCheckPathResult `json:"paths"`
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
