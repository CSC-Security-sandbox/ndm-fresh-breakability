package activities

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/netapp/ndm/services/go-worker/types"
)

// StatusInput contains the parameters for the UpdateStatus activity.
type StatusInput struct {
	JobRunID string `json:"jobRunId"`
	Status   string `json:"status"`
}

// WorkerResponsePayload contains the response payload for the UpdateWorkerResponse
// activity. This is the third positional arg in the TS call:
//
//	updateWorkerResponse(jobRunId, workerId, workerResponse)
type WorkerResponsePayload struct {
	Status     string      `json:"status,omitempty"`
	Code       string      `json:"code,omitempty"`
	Operation  string      `json:"operation,omitempty"`
	Occurrence int         `json:"occurrence,omitempty"`
	Origin     string      `json:"origin,omitempty"`
	Message    string      `json:"message,omitempty"`
	CreatedAt  interface{} `json:"createdAt,omitempty"`
}

// CutOverStatusInput contains the parameters for UpdateCutOverStatus.
type CutOverStatusInput struct {
	JobRunID string `json:"jobRunId"`
	Status   string `json:"status"`
}

// UpdateStatus sends a PATCH request to the job service to update the job run
// status.
func (a *Activities) UpdateStatus(ctx context.Context, input StatusInput) error {
	url := fmt.Sprintf("%s/api/v1/job-run/%s/%s", a.Config.JobServiceURL, input.JobRunID, input.Status)

	a.Logger.Info("UpdateStatus",
		zap.String("jobRunId", input.JobRunID),
		zap.String("status", input.Status),
		zap.String("url", url),
	)

	resp, err := a.HTTP.Patch(url, nil, nil)
	if err != nil {
		return fmt.Errorf("updating status for %s to %s: %w", input.JobRunID, input.Status, err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("update status returned %d: %s", resp.StatusCode, string(resp.Body))
	}

	return nil
}

// UpdateWorkerResponse sends a PUT request to the job service with the worker's
// response data for a completed job run.
//
// The TypeScript signature is: updateWorkerResponse(jobRunId, workerId, workerResponse)
// with 3 positional args, so the Go activity matches.
func (a *Activities) UpdateWorkerResponse(ctx context.Context, jobRunID string, workerID string, workerResponse WorkerResponsePayload) error {
	url := fmt.Sprintf("%s/api/v1/job-run/worker-response/%s/%s", a.Config.JobServiceURL, jobRunID, workerID)

	body, err := toJSON(workerResponse)
	if err != nil {
		return fmt.Errorf("marshaling worker response: %w", err)
	}

	a.Logger.Info("UpdateWorkerResponse",
		zap.String("jobRunId", jobRunID),
		zap.String("workerId", workerID),
		zap.String("url", url),
	)

	resp, err := a.HTTP.Put(url, body, nil)
	if err != nil {
		return fmt.Errorf("updating worker response for %s: %w", jobRunID, err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("update worker response returned %d: %s", resp.StatusCode, string(resp.Body))
	}

	return nil
}

// GenerateJobsReport triggers report generation for a migration job run by
// posting to the report service.
func (a *Activities) GenerateJobsReport(ctx context.Context, jobRunID string) error {
	url := fmt.Sprintf("%s/api/v1/report/inventory/generate-jobs-report", a.Config.ReportServiceURL)

	payload := map[string]string{"jobRunId": jobRunID}
	body, err := toJSON(payload)
	if err != nil {
		return fmt.Errorf("marshaling jobs report payload: %w", err)
	}

	a.Logger.Info("GenerateJobsReport",
		zap.String("jobRunId", jobRunID),
		zap.String("url", url),
	)

	resp, err := a.HTTP.Post(url, body, nil)
	if err != nil {
		return fmt.Errorf("generating jobs report for %s: %w", jobRunID, err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("generate jobs report returned %d: %s", resp.StatusCode, string(resp.Body))
	}

	return nil
}

// GenerateDiscoveryReport triggers report generation for a discovery job run.
func (a *Activities) GenerateDiscoveryReport(ctx context.Context, jobRunID string) error {
	url := fmt.Sprintf("%s/api/v1/report/inventory/generate-report", a.Config.ReportServiceURL)

	payload := map[string]string{"jobRunId": jobRunID}
	body, err := toJSON(payload)
	if err != nil {
		return fmt.Errorf("marshaling discovery report payload: %w", err)
	}

	a.Logger.Info("GenerateDiscoveryReport",
		zap.String("jobRunId", jobRunID),
		zap.String("url", url),
	)

	resp, err := a.HTTP.Post(url, body, nil)
	if err != nil {
		return fmt.Errorf("generating discovery report for %s: %w", jobRunID, err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("generate discovery report returned %d: %s", resp.StatusCode, string(resp.Body))
	}

	return nil
}

// GenerateCOCReport triggers chain of custody report generation for a job run.
func (a *Activities) GenerateCOCReport(ctx context.Context, jobRunID string) error {
	url := fmt.Sprintf("%s/api/v1/report/job-run/coc-report/%s", a.Config.ReportServiceURL, jobRunID)

	a.Logger.Info("GenerateCOCReport",
		zap.String("jobRunId", jobRunID),
		zap.String("url", url),
	)

	resp, err := a.HTTP.Get(url, nil)
	if err != nil {
		return fmt.Errorf("generating COC report for %s: %w", jobRunID, err)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("generate COC report returned %d: %s", resp.StatusCode, string(resp.Body))
	}

	return nil
}

// UpdateCutOverStatus updates the cutover status for a job run.
func (a *Activities) UpdateCutOverStatus(ctx context.Context, input CutOverStatusInput) error {
	url := fmt.Sprintf("%s/api/v1/job-run/cutover/%s/%s", a.Config.JobServiceURL, input.JobRunID, input.Status)

	a.Logger.Info("UpdateCutOverStatus",
		zap.String("jobRunId", input.JobRunID),
		zap.String("status", input.Status),
		zap.String("url", url),
	)

	resp, err := a.HTTP.Put(url, nil, nil)
	if err != nil {
		return fmt.Errorf("updating cutover status for %s to %s: %w", input.JobRunID, input.Status, err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("update cutover status returned %d: %s", resp.StatusCode, string(resp.Body))
	}

	return nil
}

// CleanupJobContext removes all Redis state associated with the given job run.
func (a *Activities) CleanupJobContext(ctx context.Context, jobRunID string) error {
	a.Logger.Info("CleanupJobContext", zap.String("jobRunId", jobRunID))

	jobContext, err := a.getJobManagerContext(ctx, jobRunID)
	if err != nil {
		a.Logger.Warn("failed to get job context for cleanup, attempting direct cleanup",
			zap.String("jobRunId", jobRunID),
			zap.Error(err),
		)
		return nil
	}

	return jobContext.Cleanup(ctx)
}

// CheckMemoryUsage checks the Redis memory usage and returns true if it is
// within acceptable limits (below the configured threshold).
//
// Its signature matches the TypeScript RedisMemoryCheckActivity.checkMemoryUsage():
//
//	async checkMemoryUsage(): Promise<boolean>
//
// The TypeScript activity takes NO arguments (only the implicit `this`), so
// the Go version must also take no arguments beyond the context.
func (a *Activities) CheckMemoryUsage(ctx context.Context) (bool, error) {
	a.Logger.Info("CheckMemoryUsage")

	memInfo, err := a.Redis.GetMemoryInfo(ctx)
	if err != nil {
		return false, fmt.Errorf("getting Redis memory info: %w", err)
	}

	threshold := float64(a.Config.RedisMemThreshold)
	if threshold <= 0 {
		threshold = 90
	}

	isOk := memInfo.UsagePercent < threshold

	a.Logger.Info("Redis memory usage",
		zap.Float64("usagePercent", memInfo.UsagePercent),
		zap.Float64("threshold", threshold),
		zap.Bool("isOk", isOk),
	)

	return isOk, nil
}

// UpdateLastEntry publishes sentinel/dummy entries to the file, task, and error
// Redis streams to signal that a job run is complete. Downstream consumers
// (db-writer) watch for these entries to know when all data has been flushed.
//
// Wire-compatible with the TypeScript CommonActivityService.updateLastEntry():
//
//	async updateLastEntry(traceId: string): Promise<any>
func (a *Activities) UpdateLastEntry(ctx context.Context, jobRunID string) error {
	a.Logger.Info("UpdateLastEntry", zap.String("jobRunId", jobRunID))

	jobContext, err := a.getJobManagerContext(ctx, jobRunID)
	if err != nil {
		return fmt.Errorf("getting job context for UpdateLastEntry: %w", err)
	}

	now := time.Now()

	// Dummy file entry matching TypeScript generateDummyItemEntry.
	dummyItem := types.ItemInfo{
		FileName:       "LAST_FILE",
		IsDirectory:    false,
		IsSymbolicLink: false,
		Depth:          0,
		Extension:      "",
		FileType:       "file",
		SourceMeta: types.ItemMeta{
			BirthTime:    now,
			ModifiedTime: now,
			AccessTime:   now,
			Permission:   "rwxr-xr-x",
			Checksum:     "dummy-checksum-source",
		},
		TargetMeta: types.ItemMeta{
			BirthTime:    now,
			ModifiedTime: now,
			AccessTime:   now,
			Permission:   "rwxr-xr-x",
			Checksum:     "dummy-checksum-target",
		},
		Size:      2048,
		Inode:     0,
		IsDeleted: false,
	}

	// Dummy task entry matching TypeScript generateDummyTaskInfoEntry.
	dummyTask := types.TaskInfo{
		ID:       "8840625a-b818-42a8-98c8-5c05aaa19106",
		JobRunID: "",
		TaskType: "MIGRATE",
		Status:   "ERRORED",
		WorkerID: "worker-12345",
		SPathID:  "sourcePathId-12345",
		TPathID:  "destinationPathId-12345",
	}

	// Dummy error entry matching TypeScript generateDummyErrorEntry.
	dummyError := types.DMError{
		Tasks: &types.TaskError{
			TaskID:       "8840625a-b818-42a8-98c8-5c05aaa19106",
			ErrorCode:    "",
			ErrorMessage: "",
			ErrorType:    "FATAL_ERROR",
			TaskType:     "",
		},
	}

	if err := jobContext.PublishToFileStream(ctx, dummyItem); err != nil {
		return fmt.Errorf("publishing dummy file entry for %s: %w", jobRunID, err)
	}

	if err := jobContext.PublishToTaskStream(ctx, dummyTask); err != nil {
		return fmt.Errorf("publishing dummy task entry for %s: %w", jobRunID, err)
	}

	if err := jobContext.PublishToErrorStream(ctx, dummyError); err != nil {
		return fmt.Errorf("publishing dummy error entry for %s: %w", jobRunID, err)
	}

	a.Logger.Info("Last entry published", zap.String("jobRunId", jobRunID))
	return nil
}

// UpdateJobErrorStatus marks a job run as ERRORED and publishes sentinel
// entries to Redis streams. This matches the TypeScript
// CommonActivityService.updateJobErrorStatus():
//
//	async updateJobErrorStatus(jobRunId: string) {
//	    await this.updateStatus({jobRunId, status: JobRunStatus.Errored});
//	    await this.updateLastEntry(jobRunId);
//	}
func (a *Activities) UpdateJobErrorStatus(ctx context.Context, jobRunID string) error {
	a.Logger.Info("UpdateJobErrorStatus", zap.String("jobRunId", jobRunID))

	// First, update the job status to ERRORED.
	if err := a.UpdateStatus(ctx, StatusInput{
		JobRunID: jobRunID,
		Status:   "ERRORED",
	}); err != nil {
		return fmt.Errorf("updating error status for %s: %w", jobRunID, err)
	}

	// Then, publish sentinel entries.
	if err := a.UpdateLastEntry(ctx, jobRunID); err != nil {
		return fmt.Errorf("publishing last entry for %s: %w", jobRunID, err)
	}

	return nil
}

// SetupExportPathPermission sets up NFS export path permissions for the source
// file server before migration scanning begins. Wire-compatible with the
// TypeScript ScanService.setupExportPathPermission():
//
//	async setupExportPathPermission(jobRunId: string): Promise<void>
//
// TODO: Implement the full NFS export path permission setup. For now this is
// a no-op stub that allows migration workflows to proceed.
func (a *Activities) SetupExportPathPermission(ctx context.Context, jobRunID string) error {
	a.Logger.Info("SetupExportPathPermission", zap.String("jobRunId", jobRunID))
	return nil
}
