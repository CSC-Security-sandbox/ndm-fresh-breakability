package types

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vmihailenco/msgpack/v5"
)

func TestCmd_MsgpackRoundTrip(t *testing.T) {
	original := Cmd{
		ID:     "cmd-1",
		FPath:  "/source/file.txt",
		Status: CommandStatusReady,
		IsDir:  false,
		Ops: Operations{
			OpsCopyContent: Ops{
				Status: OpsStatusReady,
				Params: map[string]any{"key": "value"},
			},
		},
		Metadata: &CmdMeta{
			Size:  1024,
			Mtime: time.Date(2024, 1, 15, 10, 30, 0, 0, time.UTC),
			Atime: time.Date(2024, 1, 15, 10, 30, 0, 0, time.UTC),
			Ctime: time.Date(2024, 1, 15, 10, 30, 0, 0, time.UTC),
			Mode:  0644,
			UID:   1000,
			GID:   1000,
		},
	}

	data, err := msgpack.Marshal(original)
	require.NoError(t, err)
	require.NotEmpty(t, data)

	var decoded Cmd
	err = msgpack.Unmarshal(data, &decoded)
	require.NoError(t, err)

	assert.Equal(t, original.ID, decoded.ID)
	assert.Equal(t, original.FPath, decoded.FPath)
	assert.Equal(t, original.Status, decoded.Status)
	assert.Equal(t, original.IsDir, decoded.IsDir)
	assert.NotNil(t, decoded.Ops)
	assert.Contains(t, decoded.Ops, OpsCopyContent)
	assert.Equal(t, OpsStatusReady, decoded.Ops[OpsCopyContent].Status)
	assert.NotNil(t, decoded.Metadata)
	assert.Equal(t, int64(1024), decoded.Metadata.Size)
}

func TestCmdMeta_MsgpackRoundTrip(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	original := CmdMeta{
		Size:      2048,
		Mtime:     now,
		Atime:     now,
		Ctime:     now,
		Birthtime: now,
		Mode:      0755,
		UID:       501,
		GID:       20,
		SID:       "S-1-5-21-123",
		Inode:     999,
		IsSymLink: true,
	}

	data, err := msgpack.Marshal(original)
	require.NoError(t, err)

	var decoded CmdMeta
	err = msgpack.Unmarshal(data, &decoded)
	require.NoError(t, err)

	assert.Equal(t, original.Size, decoded.Size)
	assert.Equal(t, original.Mode, decoded.Mode)
	assert.Equal(t, original.UID, decoded.UID)
	assert.Equal(t, original.GID, decoded.GID)
	assert.Equal(t, original.SID, decoded.SID)
	assert.Equal(t, original.Inode, decoded.Inode)
	assert.Equal(t, original.IsSymLink, decoded.IsSymLink)
}

func TestTaskInfo_MsgpackRoundTrip(t *testing.T) {
	original := TaskInfo{
		ID:                  "task-1",
		JobRunID:            "run-1",
		TaskType:            TaskTypeScan,
		Status:              TaskStatusPending,
		WorkerID:            "worker-1",
		SPathID:             "spath-1",
		TPathID:             "tpath-1",
		ExcludeFilePatterns: "*.tmp",
		RetryCount:          3,
		Commands: []Cmd{
			{
				ID:     "cmd-1",
				FPath:  "/test",
				Status: CommandStatusReady,
				IsDir:  true,
			},
		},
	}

	data, err := msgpack.Marshal(original)
	require.NoError(t, err)

	var decoded TaskInfo
	err = msgpack.Unmarshal(data, &decoded)
	require.NoError(t, err)

	assert.Equal(t, original.ID, decoded.ID)
	assert.Equal(t, original.JobRunID, decoded.JobRunID)
	assert.Equal(t, original.TaskType, decoded.TaskType)
	assert.Equal(t, original.Status, decoded.Status)
	assert.Equal(t, original.WorkerID, decoded.WorkerID)
	assert.Equal(t, original.SPathID, decoded.SPathID)
	assert.Equal(t, original.TPathID, decoded.TPathID)
	assert.Equal(t, original.ExcludeFilePatterns, decoded.ExcludeFilePatterns)
	assert.Equal(t, original.RetryCount, decoded.RetryCount)
	assert.Len(t, decoded.Commands, 1)
	assert.Equal(t, "cmd-1", decoded.Commands[0].ID)
}

func TestItemInfo_MsgpackRoundTrip(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	original := ItemInfo{
		FileName:       "report.pdf",
		IsDirectory:    false,
		IsSymbolicLink: false,
		Depth:          2,
		Extension:      ".pdf",
		FileType:       FileTypeFile,
		SourceMeta: ItemMeta{
			BirthTime:    now,
			ModifiedTime: now,
			AccessTime:   now,
			Permission:   "0644",
			UID:          1000,
			GID:          1000,
			Checksum:     "abc123",
		},
		TargetMeta: ItemMeta{
			BirthTime:    now,
			ModifiedTime: now,
			AccessTime:   now,
			Permission:   "0644",
		},
		Size:      4096,
		Inode:     12345,
		IsDeleted: false,
	}

	data, err := msgpack.Marshal(original)
	require.NoError(t, err)

	var decoded ItemInfo
	err = msgpack.Unmarshal(data, &decoded)
	require.NoError(t, err)

	assert.Equal(t, original.FileName, decoded.FileName)
	assert.Equal(t, original.IsDirectory, decoded.IsDirectory)
	assert.Equal(t, original.IsSymbolicLink, decoded.IsSymbolicLink)
	assert.Equal(t, original.Depth, decoded.Depth)
	assert.Equal(t, original.Extension, decoded.Extension)
	assert.Equal(t, original.FileType, decoded.FileType)
	assert.Equal(t, original.Size, decoded.Size)
	assert.Equal(t, original.Inode, decoded.Inode)
	assert.Equal(t, original.SourceMeta.Checksum, decoded.SourceMeta.Checksum)
	assert.Equal(t, original.SourceMeta.Permission, decoded.SourceMeta.Permission)
}

// Test enum constants have correct string values
func TestOpsCmd_Constants(t *testing.T) {
	assert.Equal(t, "cc", OpsCopyContent)
	assert.Equal(t, "sm", OpsStampMeta)
	assert.Equal(t, "cf", OpsCopyFile)
	assert.Equal(t, "cd", OpsCopyDir)
	assert.Equal(t, "rd", OpsRemoveDir)
	assert.Equal(t, "rf", OpsRemoveFile)
	assert.Equal(t, "cs", OpsCopySymlink)
}

func TestOpsStatus_Constants(t *testing.T) {
	assert.Equal(t, "READY", OpsStatusReady)
	assert.Equal(t, "IN_PROCESS", OpsStatusInProcess)
	assert.Equal(t, "ERROR", OpsStatusError)
	assert.Equal(t, "COMPLETED", OpsStatusCompleted)
}

func TestCommandStatus_Constants(t *testing.T) {
	assert.Equal(t, "READY", CommandStatusReady)
	assert.Equal(t, "IN_PROCESS", CommandStatusInProcess)
	assert.Equal(t, "ERROR", CommandStatusError)
	assert.Equal(t, "COMPLETED", CommandStatusCompleted)
}

func TestTaskStatus_Constants(t *testing.T) {
	assert.Equal(t, "PENDING", TaskStatusPending)
	assert.Equal(t, "RUNNING", TaskStatusRunning)
	assert.Equal(t, "ERRORED", TaskStatusErrored)
	assert.Equal(t, "COMPLETED", TaskStatusCompleted)
	assert.Equal(t, "COMPLETED_WITH_ERROR", TaskStatusCompletedWithError)
}

func TestJobStatus_Constants(t *testing.T) {
	assert.Equal(t, "READY", JobStatusReady)
	assert.Equal(t, "PENDING", JobStatusPending)
	assert.Equal(t, "RUNNING", JobStatusRunning)
	assert.Equal(t, "PAUSED", JobStatusPaused)
	assert.Equal(t, "STOPPED", JobStatusStopped)
	assert.Equal(t, "COMPLETED", JobStatusCompleted)
	assert.Equal(t, "FAILED", JobStatusFailed)
	assert.Equal(t, "ERRORED", JobStatusErrored)
}

func TestJobType_Constants(t *testing.T) {
	assert.Equal(t, "validate_connection", JobTypeValidateConnection)
	assert.Equal(t, "discovery", JobTypeDiscovery)
	assert.Equal(t, "migration", JobTypeMigration)
	assert.Equal(t, "cutover", JobTypeCutover)
	assert.Equal(t, "speed_test", JobTypeSpeedTest)
}

func TestProtocolType_Constants(t *testing.T) {
	assert.Equal(t, "SMB", ProtocolSMB)
	assert.Equal(t, "NFS", ProtocolNFS)
}

func TestTaskType_Constants(t *testing.T) {
	assert.Equal(t, "SCAN", TaskTypeScan)
	assert.Equal(t, "MIGRATE", TaskTypeMigrate)
}

func TestFileType_Constants(t *testing.T) {
	assert.Equal(t, "file", FileTypeFile)
	assert.Equal(t, "directory", FileTypeDirectory)
	assert.Equal(t, "symbolicLink", FileTypeSymbolicLink)
	assert.Equal(t, "junction", FileTypeJunction)
	assert.Equal(t, "volumeMountPoint", FileTypeVolumeMountPoint)
}

func TestErrorType_Constants(t *testing.T) {
	assert.Equal(t, "FATAL_ERROR", ErrorTypeFatal)
	assert.Equal(t, "TRANSIENT_ERROR", ErrorTypeTransient)
	assert.Equal(t, "RECOVERABLE_ERROR", ErrorTypeRecoverable)
}

func TestOrigin_Constants(t *testing.T) {
	assert.Equal(t, "SOURCE", OriginSource)
	assert.Equal(t, "DESTINATION", OriginDestination)
}

func TestFatalError(t *testing.T) {
	err := NewFatalError("something broke")
	assert.Equal(t, "fatal error: something broke", err.Error())
	assert.True(t, IsFatalError(err))
}

func TestRetryableError(t *testing.T) {
	err := NewRetryableError("try again")
	assert.Equal(t, "retryable error: try again", err.Error())
	assert.False(t, IsFatalError(err))
}

func TestRetryExceededError(t *testing.T) {
	err := NewRetryExceededError("too many retries")
	assert.Equal(t, "retry exceeded: too many retries", err.Error())
	assert.True(t, IsFatalError(err))
}

func TestIsFatalError_Nil(t *testing.T) {
	assert.False(t, IsFatalError(nil))
}

func TestTaskStats(t *testing.T) {
	stats := NewTaskStats("scan-task")
	assert.Equal(t, "scan-task", stats.TaskName)
	assert.Equal(t, 0, stats.NumFiles)
	assert.Equal(t, 0, stats.NumDirs)
	assert.Equal(t, 0, stats.NumErrors)

	stats.IncrementFiles(5)
	assert.Equal(t, 5, stats.NumFiles)

	stats.IncrementDirs(3)
	assert.Equal(t, 3, stats.NumDirs)

	stats.IncrementErrors(1)
	assert.Equal(t, 1, stats.NumErrors)
}

func TestDMError(t *testing.T) {
	taskErr := &TaskError{
		TaskID:       "task-1",
		ErrorCode:    "ERR_001",
		ErrorMessage: "something failed",
		ErrorType:    ErrorTypeFatal,
	}
	opErr := &OperationError{
		OperationID:  "op-1",
		ErrorCode:    "ERR_002",
		ErrorMessage: "file not found",
		ErrorType:    ErrorTypeTransient,
	}

	dmErr := NewDMError(taskErr, opErr)
	assert.NotNil(t, dmErr.Tasks)
	assert.NotNil(t, dmErr.Operation)
	assert.Equal(t, "task-1", dmErr.Tasks.TaskID)
	assert.Equal(t, "op-1", dmErr.Operation.OperationID)
}

func TestJobConfig_MsgpackRoundTrip(t *testing.T) {
	original := JobConfig{
		JobID:   "job-1",
		JobType: JobTypeMigration,
		SourceFileServer: FileServerDetails{
			Hostname: "src-host",
			PathID:   "path-1",
			Path:     "/data",
		},
		SourcePath: "/data",
		WorkerIDs:  []string{"w1", "w2"},
	}

	data, err := msgpack.Marshal(original)
	require.NoError(t, err)

	var decoded JobConfig
	err = msgpack.Unmarshal(data, &decoded)
	require.NoError(t, err)

	assert.Equal(t, original.JobID, decoded.JobID)
	assert.Equal(t, original.JobType, decoded.JobType)
	assert.Equal(t, original.SourceFileServer.Hostname, decoded.SourceFileServer.Hostname)
	assert.Equal(t, original.SourcePath, decoded.SourcePath)
	assert.Equal(t, original.WorkerIDs, decoded.WorkerIDs)
}
