package types

// TaskInfo represents a task read from / written to a Redis stream. It matches
// the TypeScript TaskInfo class in stream-datatypes.ts and is used as the
// lower-level wire format for the older command-stream protocol.
type TaskInfo struct {
	ID                  string `json:"id" msgpack:"id"`
	JobRunID            string `json:"jobRunId" msgpack:"jobRunId"`
	TaskType            string `json:"taskType" msgpack:"taskType"`
	Status              string `json:"status" msgpack:"status"`
	WorkerID            string `json:"workerId" msgpack:"workerId"`
	SPathID             string `json:"sPathId" msgpack:"sPathId"`
	TPathID             string `json:"tPathId,omitempty" msgpack:"tPathId,omitempty"`
	ExcludeFilePatterns string `json:"excludeFilePatterns,omitempty" msgpack:"excludeFilePatterns,omitempty"`
	RetryCount          int    `json:"retryCount" msgpack:"retryCount"`
	Commands            []Cmd  `json:"commands" msgpack:"commands"`
}

// Task represents the richer task structure used by the metadata-types system.
// Wire-compatible with the TypeScript Task class in metadata-types.ts.
type Task struct {
	ID                  string    `json:"id" msgpack:"id"`
	JobRunID            string    `json:"jobRunId" msgpack:"jobRunId"`
	TaskType            string    `json:"taskType" msgpack:"taskType"`
	Status              string    `json:"status" msgpack:"status"`
	WorkerID            string    `json:"workerId" msgpack:"workerId"`
	SPath               string    `json:"sPath" msgpack:"sPath"`
	SPathID             string    `json:"sPathId" msgpack:"sPathId"`
	TPath               string    `json:"tPath,omitempty" msgpack:"tPath,omitempty"`
	TPathID             string    `json:"tPathId,omitempty" msgpack:"tPathId,omitempty"`
	ExcludeFilePatterns string    `json:"excludeFilePatterns,omitempty" msgpack:"excludeFilePatterns,omitempty"`
	Commands            []Command `json:"commands" msgpack:"commands"`
}

// TaskStats tracks aggregate counters for a single task execution. Wire-
// compatible with the TypeScript TaskStats class in metadata-types.ts.
type TaskStats struct {
	NumFiles  int    `json:"numFiles" msgpack:"numFiles"`
	NumDirs   int    `json:"numDirs" msgpack:"numDirs"`
	NumErrors int    `json:"numErrors" msgpack:"numErrors"`
	TaskName  string `json:"taskName" msgpack:"taskName"`
}

// NewTaskStats creates a TaskStats with the given task name and zeroed
// counters.
func NewTaskStats(taskName string) *TaskStats {
	return &TaskStats{TaskName: taskName}
}

// IncrementFiles adds delta to the file counter.
func (ts *TaskStats) IncrementFiles(delta int) {
	ts.NumFiles += delta
}

// IncrementDirs adds delta to the directory counter.
func (ts *TaskStats) IncrementDirs(delta int) {
	ts.NumDirs += delta
}

// IncrementErrors adds delta to the error counter.
func (ts *TaskStats) IncrementErrors(delta int) {
	ts.NumErrors += delta
}
