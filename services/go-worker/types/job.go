package types

// Protocol represents a file-server authentication protocol (SMB or NFS).
// Wire-compatible with the TypeScript Protocol abstract class in protocols.ts.
type Protocol struct {
	Type     string `json:"type" msgpack:"type"`
	Username string `json:"username" msgpack:"username"`
	Password string `json:"password,omitempty" msgpack:"password,omitempty"`
}

// FileServerDetails describes a source or destination file server, including
// its protocol, credentials, and mount paths. Wire-compatible with the
// TypeScript FileServerDetails class in file-server.ts.
type FileServerDetails struct {
	Hostname         string     `json:"hostname" msgpack:"hostname"`
	Protocols        []Protocol `json:"protocols" msgpack:"protocols"`
	Password         string     `json:"password" msgpack:"password"`
	PathID           string     `json:"pathId" msgpack:"pathId"`
	Username         string     `json:"username" msgpack:"username"`
	Path             string     `json:"path" msgpack:"path"`
	WorkingDirectory string     `json:"workingDirectory" msgpack:"workingDirectory"`
	ProtocolVersion  string     `json:"protocolVersion" msgpack:"protocolVersion"`
}

// Options holds optional migration behaviour flags. Wire-compatible with the
// TypeScript Options interface in options.ts.
type Options struct {
	PreserveAccessTime         bool   `json:"preserveAccessTime,omitempty" msgpack:"preserveAccessTime,omitempty"`
	ExcludeOlderThan           string `json:"excludeOlderThan,omitempty" msgpack:"excludeOlderThan,omitempty"`
	ExcludeFilePattern         string `json:"excludeFilePattern,omitempty" msgpack:"excludeFilePattern,omitempty"`
	SkipsFilesModifiedInLast   string `json:"skipsFilesModifiedInLast,omitempty" msgpack:"skipsFilesModifiedInLast,omitempty"`
	IsIdentityMappingAvailable bool   `json:"isIdentityMappingAvailable,omitempty" msgpack:"isIdentityMappingAvailable,omitempty"`
	ShouldScanADS              bool   `json:"shouldScanADS,omitempty" msgpack:"shouldScanADS,omitempty"`
}

// JobConfig is the top-level configuration for a single job execution.
// Wire-compatible with the TypeScript JobConfig class in job-config.ts.
type JobConfig struct {
	JobID                 string             `json:"jobId" msgpack:"jobId"`
	JobType               string             `json:"jobType" msgpack:"jobType"`
	SourceFileServer      FileServerDetails  `json:"sourceFileServer" msgpack:"sourceFileServer"`
	SourcePath            string             `json:"sourcePath" msgpack:"sourcePath"`
	WorkerIDs             []string           `json:"workerIds,omitempty" msgpack:"workerIds,omitempty"`
	DestinationFileServer *FileServerDetails `json:"destinationFileServer,omitempty" msgpack:"destinationFileServer,omitempty"`
	DestinationPath       string             `json:"destinationPath,omitempty" msgpack:"destinationPath,omitempty"`
	Options               *Options           `json:"options,omitempty" msgpack:"options,omitempty"`
	SkipDelete            bool               `json:"skipDelete,omitempty" msgpack:"skipDelete,omitempty"`
}

// JobState tracks the runtime state of a job across all workers.
// Wire-compatible with the TypeScript JobState class in job-state.ts.
type JobState struct {
	Workers          []string `json:"workers" msgpack:"workers"`
	TasksCompleted   int      `json:"tasks_completed" msgpack:"tasks_completed"`
	TasksTotal       int      `json:"tasks_total" msgpack:"tasks_total"`
	WorkersAgreed    []string `json:"workers_agreed" msgpack:"workers_agreed"`
	Status           string   `json:"status" msgpack:"status"`
	FailedWorkers    []string `json:"failedWorkers" msgpack:"failedWorkers"`
	IsScanCompleted  bool     `json:"isScanCompleted,omitempty" msgpack:"isScanCompleted,omitempty"`
}
