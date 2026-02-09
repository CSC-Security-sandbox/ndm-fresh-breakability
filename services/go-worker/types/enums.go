package types

// OPS_CMD constants use short keys for msgpack wire compatibility with the
// TypeScript OPS_CMD enum in jobs-lib.
const (
	OpsCopyContent = "cc"
	OpsStampMeta   = "sm"
	OpsCopyFile    = "cf"
	OpsCopyDir     = "cd"
	OpsRemoveDir   = "rd"
	OpsRemoveFile  = "rf"
	OpsCopySymlink = "cs"
)

// OPS_STATUS constants match the TypeScript OPS_STATUS enum.
const (
	OpsStatusReady     = "READY"
	OpsStatusInProcess = "IN_PROCESS"
	OpsStatusError     = "ERROR"
	OpsStatusCompleted = "COMPLETED"
)

// CommandStatus constants match the TypeScript CommandStatus enum.
const (
	CommandStatusReady     = "READY"
	CommandStatusInProcess = "IN_PROCESS"
	CommandStatusError     = "ERROR"
	CommandStatusCompleted = "COMPLETED"
)

// TaskStatus constants match the TypeScript TaskStatus enum.
const (
	TaskStatusPending            = "PENDING"
	TaskStatusRunning            = "RUNNING"
	TaskStatusErrored            = "ERRORED"
	TaskStatusCompleted          = "COMPLETED"
	TaskStatusCompletedWithError = "COMPLETED_WITH_ERROR"
)

// JobStatus constants match the TypeScript JobStatus enum.
// Note: the TypeScript enum uses uppercase values (e.g. "READY"), which differs
// from the user-facing request that listed mixed-case. We use the actual wire
// values from the TypeScript source.
const (
	JobStatusReady     = "READY"
	JobStatusPending   = "PENDING"
	JobStatusRunning   = "RUNNING"
	JobStatusPaused    = "PAUSED"
	JobStatusStopped   = "STOPPED"
	JobStatusCompleted = "COMPLETED"
	JobStatusFailed    = "FAILED"
	JobStatusErrored   = "ERRORED"
)

// JobRunStatus constants represent the status of a specific job run.
const (
	JobRunStatusRunning   = "Running"
	JobRunStatusPaused    = "Paused"
	JobRunStatusStopped   = "Stopped"
	JobRunStatusCompleted = "Completed"
	JobRunStatusErrored   = "Errored"
	JobRunStatusBlocked   = "Blocked"
)

// ErrorType constants match the TypeScript ErrorType enum.
const (
	ErrorTypeFatal       = "FATAL_ERROR"
	ErrorTypeTransient   = "TRANSIENT_ERROR"
	ErrorTypeRecoverable = "RECOVERABLE_ERROR"
)

// TaskType constants match the TypeScript TaskType enum.
const (
	TaskTypeScan    = "SCAN"
	TaskTypeMigrate = "MIGRATE"
)

// JobType constants match the TypeScript JobType enum. The wire values use
// lowercase with underscores, matching the TypeScript source.
const (
	JobTypeValidateConnection = "validate_connection"
	JobTypeDiscovery          = "discovery"
	JobTypeMigration          = "migration"
	JobTypeCutover            = "cutover"
	JobTypeSpeedTest          = "speed_test"
)

// ProtocolType constants match the TypeScript ProtocolType enum.
const (
	ProtocolSMB = "SMB"
	ProtocolNFS = "NFS"
)

// GroupReaderType constants match the TypeScript GroupReaderType enum.
const (
	GroupReaderWorker   = "worker"
	GroupReaderDBWriter = "db-writer"
)

// FileType constants represent filesystem entry types.
const (
	FileTypeFile             = "file"
	FileTypeDirectory        = "directory"
	FileTypeSymbolicLink     = "symbolicLink"
	FileTypeJunction         = "junction"
	FileTypeVolumeMountPoint = "volumeMountPoint"
)

// JobReportType constants represent the type of report produced by a job.
const (
	JobReportTypeDiscover = "DISCOVER"
	JobReportTypeMigrate  = "MIGRATE"
	JobReportTypeCutOver  = "CUT_OVER"
)

// Origin constants represent whether an entity belongs to the source or
// destination side of a migration.
const (
	OriginSource      = "SOURCE"
	OriginDestination = "DESTINATION"
)

// Operation constants represent the fine-grained file operations that a worker
// may execute.
const (
	OperationCopyContent = "COPY_CONTENT"
	OperationReadDir     = "READ_DIR"
	OperationReadFile    = "READ_FILE"
	OperationStampMeta   = "STAMP_META"
	OperationStampTime   = "STAMP_TIME"
)

// IdentityType constants match the TypeScript IdentityTypes enum.
const (
	IdentityTypeSID = "SID"
	IdentityTypeUID = "UID"
	IdentityTypeGID = "GID"
)
