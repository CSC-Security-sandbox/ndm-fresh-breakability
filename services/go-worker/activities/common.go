package activities

import (
	"context"
	"fmt"
	"net/http"

	"go.uber.org/zap"
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
func (a *Activities) CheckMemoryUsage(ctx context.Context, jobRunID string) (bool, error) {
	a.Logger.Info("CheckMemoryUsage", zap.String("jobRunId", jobRunID))

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
